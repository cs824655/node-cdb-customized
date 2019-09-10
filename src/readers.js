// Helpers for reading raw data
// Should consider separating this file to a new package
const fs = require('fs');
const doAsync = require('doasync');

const asyncFs = doAsync(fs);

// Readers should implement the "read" function, and optionally an async open function and an async close function.

class RawFileReader {
  constructor(filename) {
    this.filename = filename;
    this.fd = null;
  }

  async open() {
    this.fd = await asyncFs.open(this.filename, 'r');
  }

  async read(start, length) {
    const self = this;
    const { buffer } = await asyncFs.read(self.fd, Buffer.alloc(length), 0, length, start);
    return buffer;
  }

  async close() {
    return asyncFs.close(this.fd);
  }
}

class RawBufferReader {
  constructor(buffer) {
    this.buffer = buffer;
  }

  async read(start, length) {
    return this.buffer.slice(start, start + length);
  }
}

function castToReader(reader) {
  if (typeof reader === 'string') {
    return new RawFileReader(reader);
  }
  if (Buffer.isBuffer(reader)) {
    return new RawBufferReader(reader);
  }
  if (!reader
  || (typeof reader.read !== 'function')
  || (reader.open && (typeof reader.open !== 'function'))
  || (reader.close && (typeof reader.close !== 'function'))) {
    throw new TypeError('Invalid reader, must have a read() function and if open and close are defined they should be functions');
  }
  return reader;
}

function quotient(a, b) { // floored division
  return (a - (a % b)) / b;
}

class CachedRawReaderWrapper {
  constructor(reader, { blockSize = 8192, blocksLimit = 1000 } = {}) {
    this.reader = castToReader(reader);
    this.blockSize = blockSize;
    this.blocksLimit = blocksLimit;
    this.newCache = new Map();
    this.oldCache = new Map();
  }

  async open() {
    if (this.reader.open) {
      return this.reader.open();
    }
    return null;
  }

  async close() {
    if (this.reader.close) {
      return this.reader.close();
    }
    return null;
  }

  async readBlock(index) {
    const cachedBlock = this.newCache.get(index);
    if (cachedBlock) {
      return cachedBlock;
    }
    const block = this.oldCache.get(index) || await this.reader.read(index * this.blockSize, this.blockSize);
    if (this.newCache.size >= this.blocksLimit / 2) {
      this.oldCache = this.newCache;
      this.newCache = new Map();
    }
    this.newCache.set(index, block);
    return block;
  }

  async read(start, length) {
    const startIndex = quotient(start, this.blockSize);
    const end = start + length;
    const endIndex = quotient(end + this.blockSize - 1, this.blockSize);
    const buffers = await Promise.all(Array.from({ length: endIndex - startIndex }, (_empty, index) => this.readBlock(startIndex + index)));
    return Buffer.concat(buffers).slice(start - startIndex * this.blockSize, end - startIndex * this.blockSize);
  }
}

exports.castToReader = castToReader;
exports.RawFileReader = RawFileReader;
exports.RawBufferReader = RawBufferReader;
exports.CachedRawReaderWrapper = CachedRawReaderWrapper;
