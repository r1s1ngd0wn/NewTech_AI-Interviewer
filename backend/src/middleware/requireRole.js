module.exports = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'insufficient permissions' });
  next();
};
