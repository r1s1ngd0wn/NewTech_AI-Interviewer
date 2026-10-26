const router = require('express').Router();
const scenarioService = require('../services/scenarioService');
const { httpError } = require('../utils/httpError');
const handle = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);

router.get('/', handle(async (req,res) => {
  const { q='', status='all', sort='title-asc', page='1' } = req.query;
  if (typeof q!=='string'||typeof status!=='string'||typeof sort!=='string'||typeof page!=='string') throw httpError(400,'invalid scenario query','INVALID_SCENARIO_QUERY');
  const result=scenarioService.adminList({q,status,sort,page:Number(page)});
  res.json(result);
}));
router.patch('/:id', handle(async (req,res) => {
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(req.params.id)) throw httpError(400,'invalid scenario ID','INVALID_SCENARIO_ID');
  res.json({ scenario: await scenarioService.update(req.params.id,req.body) });
}));
module.exports=router;
