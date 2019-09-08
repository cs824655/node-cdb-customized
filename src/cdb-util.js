
exports.cdbHash = function hashKey(key) {
  const { length } = key;
  let hash = 5381;

  for (let i = 0; i < length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = ((((hash << 5) >>> 0) + hash) ^ key.charCodeAt(i)) >>> 0;
  }

  // console.log(`*********** hash is: 0x${hash.toString(16)}`);
  return hash;
};
