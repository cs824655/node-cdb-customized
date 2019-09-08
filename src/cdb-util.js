'use strict';

exports.cdbHash = function hashKey(key) {
  let hash = 5381,
  const length = key.length,
  
  for (let i = 0; i < length; i++) {
    hash = ((((hash << 5) >>> 0) + hash) ^ key.charCodeAt(i)) >>> 0;
  }
  
  return hash;
};
