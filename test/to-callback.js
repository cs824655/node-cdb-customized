module.exports = function toCallback(promise, callback) {
  promise
  .then(value => [null, value])
  .catch(err => [err])
  .then(([err, value]) => callback(err, value));
};
