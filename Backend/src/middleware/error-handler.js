function notFound(req, res) {
  res.status(404).json({ error: 'not_found' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ error: status < 500 ? 'bad_request' : 'internal_server_error' });
}

module.exports = { notFound, errorHandler };
