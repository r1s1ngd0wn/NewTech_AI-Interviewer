import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
export default function AiStatusBanner() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let active = true;
    const check = () => api.aiHealth().then(h => { if (active) setHealth(h); }).catch(() => { if (active) setHealth({ available: false }); });
    check(); const timer = setInterval(check, 30000);
    window.addEventListener('interviewai:ai-health', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('interviewai:ai-health', check); };
  }, []);
  if (health?.available !== false) return null;
  return <div className="ai-banner" role="status">Tính năng AI tạm thời không khả dụng. Bạn vẫn có thể luyện phỏng vấn, xem lịch sử và quản lý kế hoạch.</div>;
}
