// Helpers for reading raw data
// Should consider separating this file to a new package
const fs = require('fs');
const doAsync = require('doasync');
const pLimit = require('p-limit');

const asyncFs = doAsync(fs);

// Readers should implement the "read" function, and optionally an async open function and an async close function.

class RawFileReader {
  constructor(filename) {
    this.filename = filename;
    this.fd = null;
    this.limit = pLimit(1);
  }

  async open() {
    this.fd = await asyncFs.open(this.filename, 'r');
  }

  async read(start, length) {
    const self = this;
    const { buffer, bytesRead } = await this.limit(async () => {
      if (self.flag) {
        console.log('!!!!!!!!!!!! WTF');
      }
      self.flag = true;
      const result = await asyncFs.read(self.fd, Buffer.alloc(length), 0, length, start);
      self.flag = false;
      return result;
    });
    if (bytesRead < length) {
      throw new Error('Unexpected end of file');
    }
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
    if (this.buffer.length < start + length) {
      throw new Error('Unexpected end of buffer');
    }
    return this.buffer.slice(start, start + length);
  }
}

function quotient(a, b) { // floored division
  return (a - (a % b)) / b;
}

class CachedRawReaderWrapper {
  constructor(reader, cacheRecordSize = 8192, cachedRecordsLimit = 1000) {
    this.reader = reader;
    this.cacheRecordSize = cacheRecordSize;
    this.cachedRecordsLimit = cachedRecordsLimit;
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

  async readRecord(index) {
    return this.reader.read(index * this.cacheRecordSize, this.cacheRecordSize);
    /*
    const cachedRecord = this.newCache.get(index);
    if (cachedRecord) {
      return cachedRecord;
    }
    const record = this.oldCache.get(index) || await this.reader.read(index * this.cacheRecordSize, this.cacheRecordSize);
    if (this.newCache.size >= this.cachedRecordsLimit / 2) {
      this.oldCache = this.newCache;
      this.newCache = new Map();
    }
    this.newCache.set(index, record);
    return record;
    */
  }

  async read(start, length) {
    const expected = await this.reader.read(start, length);
    const startIndex = quotient(start, this.cacheRecordSize);
    const end = start + length;
    const endIndex = quotient(end + this.cacheRecordSize - 1, this.cacheRecordSize);
    const buffers = await Promise.all(Array.from({ length: endIndex - startIndex }, (_empty, index) => this.readRecord(startIndex + index)));
    /*
    const result = Buffer.concat(buffers).slice(start - startIndex * this.cacheRecordSize, end - startIndex * this.cacheRecordSize);
    if (result.compare(expected) !== 0) {
      console.log('!!!!!!! WTF');
    }
    */
    
    return expected;
  }
}

exports.RawFileReader = RawFileReader;
exports.RawBufferReader = RawBufferReader;
exports.CachedRawReaderWrapper = CachedRawReaderWrapper;
