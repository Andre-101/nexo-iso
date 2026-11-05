// Express 4 no captura automáticamente los rechazos de handlers async.
module.exports = (handler) => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(next);
};
