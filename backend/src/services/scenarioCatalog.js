const crypto = require('node:crypto');
const { httpError } = require('../utils/httpError');

const PAGE_SIZE = 20;
const META_FIELDS = ['title', 'description', 'industry', 'seniority', 'questionType'];

function createScenarioCatalog({ scenarios, filePath, fs }) {
  if (!Array.isArray(scenarios) || !filePath || !fs) throw new TypeError('scenarios, filePath and fs are required');
  const originals = new Map(scenarios.map(item => [item.id, structuredClone(item)]));
  let overrides = {};
  try {
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) overrides = loaded;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let writeQueue = Promise.resolve();

  function merged(id) {
    const original = originals.get(id);
    if (!original) return null;
    const override = overrides[id] || {};
    return { ...original, ...Object.fromEntries(META_FIELDS.filter(key => override[key] !== undefined).map(key => [key, override[key]])), isActive: override.isActive !== false };
  }
  function all({ includeInactive = false } = {}) {
    return [...originals.keys()].map(merged).filter(item => includeInactive || item.isActive);
  }
  function getScenario(id) { return merged(id); }
  function getPublicScenario(id) { const item = getScenario(id); return item ? toSummary(item) : null; }
  function toSummary(item) { const { questions, persona, ...summary } = item; return { ...summary, questionCount: questions.length }; }
  function filtered({ industry, seniority, questionType } = {}, { includeInactive = false } = {}) {
    return all({ includeInactive }).filter(item => !industry || item.industry === industry)
      .filter(item => !seniority || item.seniority === seniority)
      .filter(item => !questionType || item.questionType === questionType);
  }
  function listScenarios(filters) { return filtered(filters).map(toSummary); }
  function browseScenarios({ q = '', industry, seniority, questionType, sort = 'title-asc', page = 1, pageSize = 8 } = {}, includeInactive = false) {
    const query = q.normalize('NFKC').trim().toLocaleLowerCase();
    let results = filtered({ industry, seniority, questionType }, { includeInactive }).filter(item => !query ||
      [item.title, item.industry, item.seniority, item.questionType].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(query)));
    const titleOrder = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
    if (sort === 'title-desc') results.sort((a,b) => titleOrder(b,a));
    else if (sort === 'questions-desc') results.sort((a,b) => b.questions.length - a.questions.length || titleOrder(a,b));
    else results.sort(titleOrder);
    const total = results.length, totalPages = Math.ceil(total / pageSize), currentPage = totalPages ? Math.min(page,totalPages) : 1;
    return { scenarios: results.slice((currentPage-1)*pageSize,currentPage*pageSize).map(toSummary), page: currentPage, pageSize, total, totalPages };
  }
  function recommendFor(profile) {
    const active = all();
    if (!profile || !profile.targetIndustry) return active.map(toSummary);
    const industry = active.filter(item => item.industry === profile.targetIndustry);
    const seniority = industry.filter(item => item.seniority === profile.experienceLevel);
    return (seniority.length ? seniority : industry.length ? industry : active).map(toSummary);
  }
  function getFilterOptions() {
    const active = all();
    return { industries: [...new Set(active.map(s => s.industry))], seniorities: [...new Set(active.map(s => s.seniority))], questionTypes: [...new Set(active.map(s => s.questionType))] };
  }
  function adminList({ q = '', status = 'all', sort = 'title-asc', page = 1 } = {}) {
    if (typeof q !== 'string' || q.length > 100 || !['all','active','inactive'].includes(status) || !['title-asc','title-desc','questions-desc'].includes(sort) || !Number.isSafeInteger(Number(page)) || Number(page)<1) throw httpError(400, 'invalid scenario query', 'INVALID_SCENARIO_QUERY');
    let items = all({ includeInactive: true }).filter(item => !q || [item.title,item.industry,item.seniority,item.questionType].some(v => v.toLocaleLowerCase().includes(q.toLocaleLowerCase()))).filter(item => status==='all' || item.isActive === (status==='active'));
    const cmp=(a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})||a.id.localeCompare(b.id);
    if(sort==='title-desc')items.sort((a,b)=>cmp(b,a));else if(sort==='questions-desc')items.sort((a,b)=>b.questions.length-a.questions.length||cmp(a,b));else items.sort(cmp);
    const total=items.length,totalPages=Math.ceil(total/PAGE_SIZE),currentPage=totalPages?Math.min(Number(page),totalPages):1;
    return { scenarios:items.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE).map(toSummary),page:currentPage,pageSize:PAGE_SIZE,total,totalPages };
  }
  async function update(id, patch) {
    if (!originals.has(id)) throw httpError(404, 'scenario not found', 'SCENARIO_NOT_FOUND');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !META_FIELDS.includes(key) && key !== 'isActive')) throw httpError(400, 'invalid scenario update', 'INVALID_SCENARIO_PATCH');
    const next = {};
    for (const [key,value] of Object.entries(patch)) {
      if(key==='isActive') { if(typeof value!=='boolean') throw httpError(400,'isActive must be a boolean','INVALID_SCENARIO_PATCH'); next[key]=value; continue; }
      const max=key==='title'?120:500;
      const minLength=key==='description'?0:1;
      if(typeof value!=='string'||value.trim().length<minLength||value.trim().length>max) throw httpError(400,`${key} must be up to ${max} characters`,'INVALID_SCENARIO_PATCH');
      if(['industry','seniority','questionType'].includes(key)&&value.trim().length>80) throw httpError(400,`${key} must be at most 80 characters`,'INVALID_SCENARIO_PATCH');
      next[key]=value.trim();
    }
    const dir=require('node:path').dirname(filePath);
    const temp=`${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const operation=writeQueue.then(async()=>{
      const candidate={...overrides,[id]:{...(overrides[id]||{}),...next}};
      try { fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(temp,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'}); fs.renameSync(temp,filePath); overrides=candidate; }
      catch(error){try{fs.unlinkSync(temp)}catch{} throw httpError(503,'could not persist scenario changes','SCENARIO_SAVE_FAILED');}
      return toSummary(merged(id));
    });
    writeQueue=operation.then(()=>undefined,()=>undefined);
    return operation;
  }
  return { listScenarios,browseScenarios,getScenario,getPublicScenario,recommendFor,getFilterOptions,adminList,update,isActive:id=>Boolean(merged(id)?.isActive),toSummary };
}

module.exports = { createScenarioCatalog, PAGE_SIZE };
