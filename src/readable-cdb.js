const { castToRawDataReader } = require('./raw-data-readers');
const { defaultHash } = require('./cdb-util');
const { Encoding } = require('./cdb-encoding');


class Readable {
  constructor(reader, options) {
    this.encoding = new Encoding(options ? options : {});
    this.reader = castToRawDataReader(reader);
    this.header = new Array(this.encoding.tableSize);
    this.hash = (options && options.hash) ? options.hash : defaultHash;
    
  }

  async readRaw(start, length) {
    const buffer = await this.reader.read(start, length);
    if (buffer.length < length) {
      throw new Error('Unexpected end of buffer or file');
    }
    return buffer;
  }

  async open() {
    if (this.reader.open) {
      await this.reader.open();
    }
    const buffer = await this.readRaw(0, this.encoding.headerSize);

    let bufferPosition = 0;
    for (let i = 0; i < this.encoding.tableSize; i += 1) {
      const position = this.encoding.pointerEncoding.read(buffer, bufferPosition);
      const slotCount = this.encoding.slotIndexEncoding.read(buffer, bufferPosition + this.encoding.pointerEncoding.size);

      this.header[i] = {
        position,
        slotCount,
      };

      bufferPosition += this.encoding.mainPairSize;
    }

    return this;
  }

  async* getIterator(keyParam, offsetParam = 0) {
    // console.log(`*********** Readable.get ${key} offset: ${offsetParam}`);
    const key = Buffer.from(keyParam);

    const hash = this.hash(key);
    // eslint-disable-next-line no-bitwise
    const { position, slotCount } = this.header[hash & 0xFF];
    // console.log(`*********** position ${position} slotCount: ${slotCount}`);

    let offset = offsetParam;

    if (slotCount === 0) {
      return;
    }

    // eslint-disable-next-line no-bitwise
    const initialSlot = (hash >> 8) % slotCount;

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const hashPosition = position + (((initialSlot + slotIndex) % slotCount) * this.encoding.hashPairSize);
      // console.log(`*********** reading slot ${slotIndex} at ${hashPosition}`);

      // eslint-disable-next-line no-await-in-loop
      const slotBuffer = await this.readRaw(hashPosition, this.encoding.hashPairSize);

      const recordHash = this.encoding.hashEncoding.read(slotBuffer, 0);
      const recordPosition = this.encoding.pointerEncoding.read(slotBuffer, this.encoding.hashEncoding.size);
      // console.log(`*********** recordHash 0x${recordHash.toString(16)} recordPosition 0x${recordPosition.toString(16)}`);

      if (recordPosition == 0) {
        // console.log(`*********** did not find data because an empty record was reached ${recordPosition} ${recordHash}`);
        return;
      }
      // console.log(`*********** found hash 0x${hash.toString(16)}`);
      if (recordHash === hash) {
        // eslint-disable-next-line no-await-in-loop
        const recordHeader = await this.readRaw(recordPosition, this.encoding.recordHeaderSize);

        const keyLength = this.encoding.keyLengthEncoding.read(recordHeader, 0);
        const dataLength = this.encoding.dataLengthEncoding.read(recordHeader, this.encoding.keyLengthEncoding.size);

        // In the rare case that there is a hash collision, check the key size
        // to prevent reading in a key that will definitely not match.
        // console.log(`*********** keyLength ${keyLength} trueKeyLength ${trueKeyLength}`);
        if (keyLength === key.length) {
          // eslint-disable-next-line no-await-in-loop
          const keyPayload = await this.readRaw(recordPosition + this.encoding.recordHeaderSize, keyLength);
          // console.log(`*********** found key ${keyPayload}`);
          if (Buffer.compare(keyPayload, key) === 0) {
            // console.log(`*********** same key - offset is ${offset}`);
            if (offset === 0) {
              // eslint-disable-next-line no-await-in-loop
              yield await this.readRaw(recordPosition + this.encoding.recordHeaderSize + keyLength, dataLength);
            } else {
              // console.log(`*********** reducing offset ${offset} by 1`);
              offset -= 1;
            }
          }
        }
      }
    }
    // console.log(`*********** did not find data because all records have been scanned ${slotCount}`);
  }

  async get(key, offset = 0) {
    return (await this.getIterator(key, offset).next()).value;
  }

  async close() {
    if (this.reader.close) {
      return this.reader.close();
    }
    return null;
  }
}

module.exports = Readable;
