const uInt32LE = {
  size: 4,
  read: (buffer, offset = 0) => buffer.readUInt32LE(offset),
  write: (buffer, value, offset = 0) => {
    buffer.writeUInt32LE(value, offset);
  },
};

const uInt64LE = {
  size: 8,
  // eslint-disable-next-line no-bitwise
  read: (buffer, offset = 0) => Number(BigInt(buffer.readUInt32LE(offset)) + (BigInt(buffer.readUInt32LE(offset + 4)) << 32n)),
  write: (buffer, value, offset = 0) => {
    const bigValue = BigInt(value);
    // eslint-disable-next-line no-bitwise
    buffer.writeUInt32LE(Number(bigValue & 0xFFFFFFFFn), offset);
    // eslint-disable-next-line no-bitwise
    buffer.writeUInt32LE(Number(bigValue >> 32n), offset + 4);
  },
};

function originalHash(key) {
  // DJB hash
  const { length } = key;
  let hash = 5381;

  for (let i = 0; i < length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = ((((hash << 5) >>> 0) + hash) ^ key[i]) >>> 0;
  }

  // console.log(`*********** hash is: 0x${hash.toString(16)}`);
  return hash;
}

function defaultHash(key) {
  // Using all of our 8 byte hash in the simplest way possible.
  let paddedKey = key;
  if (key.length < 4) {
    paddedKey = Buffer.alloc(4);
    key.copy(paddedKey);
  }
  // eslint-disable-next-line no-bitwise
  return originalHash(key);
}

module.exports = {
  uInt32LE,
  uInt64LE,
  originalHash,
  defaultHash,
};
