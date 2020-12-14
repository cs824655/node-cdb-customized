# node constant-db-customized [![Build Status](https://travis-ci.com/cs824655/node-cdb-customized.svg?branch=master)](https://travis-ci.com/github/cs824655/node-cdb-customized)
A [cdb](http://cr.yp.to/cdb.html) implementation in node.js, supporting both read and write capabilities, using 64bit pointers and es6 features by default. THis version also allow customized hash function as well as 32bit integers.

![alt text](./cdb64.png "Original image from: http://www.unixuser.org/~euske/doc/cdbinternals/index.html")
###### Original image from: http://www.unixuser.org/~euske/doc/cdbinternals/index.html
The image above is for the default setting of this cdb reader and writer.
Notice that the pointers were increased to 64 bits to allow larger database.
The hash-size also supports 64 bits, however [cdb's default hash-function (called djb2)](http://cr.yp.to/cdb/cdb.txt) gives results of only 32 bits.
Therefore this library uses a similar hash function - the first 32 bits are calculated with *djb2*, and the rest 32 bits are taken from the paylod's prefix (yes, it's a very primitive hash function). You can also write your own hash-function that receives a `Buffer` and returns a `Number`, and pass this function to the *Readable*/*Writeable* constructor (see following documentation).
Key-Length and Data-Length remain 4 bytes (32 bits) - this allows only 4GB for each key and each value, but saves space if the database contains lots of short key-value pairs (which is the typical use-case).

To make this work for more general use cases, you are allowed to pass optional parameters to specify whether to use 64bit or 32bit for some of all of the following values (by default, they are all 64-bit integers):
* Pointers
* Total number of slots in a subtable
* Hash value of a key


## Installation
`npm install constant-db-customized`

## Changes from the forked package [constant-db64 V3.0.0] 
* When instantiating cdb Reader or Writer, it allows an optional overwrite of hash functions, pointer size, slot index size and hash value size.
* Hash function is no longer required to return `BigInt`.

## Example
Writable cdb:
```javascript
const Writable = require('constant-db-customized').Writable;

const writer = new Writable('./cdbfile');
await writer.open();
writer.put('meow', 'hello world');
await writer.close();
console.log('hooray!');
```

Readable cdb:
```javascript
const readable = require('constant-db-customized').readable;

const reader = new readable('./cdbfile');

await reader.open();

const data = await reader.get('meow');
console.log(data); // results in 'hello world!'

await reader.close();
console.log('awesome!');
```

## Documentation
### Readable cdb
To create a new readable instance:
```javascript
const constantDb = require('constant-db-customized');
const reader = new constantDb.Readable(filename);
```

You can also pass in optional configurations for hash function and encodings, for example:
```javascript
const options = {
  hash: myHashFunction,
  isPointer32Bit: true,
  isSlotIndex32Bit: true,
  isHash32Bit: true,
}
new constantDb.Readable(filename, options);
```

For faster results that (using cache):
```javascript
const cacheReader = constandDb.rawDataReaders.RawDataReaderCacheWrapper(filename);
const reader = new constantDb.Readable(cacheReader, options);
```

`new RawDataReaderCacheWrapper(filename, options)` can be called with the following options:
* `blockSize` (default: 4096)
* `blocksLimit` (default: 2000)


`open()`

Opens the file (calls the raw-reader's `open()` function), and immediately caches the header table for the cdb (4098 bytes).

`get(key, [offset])`

Attempts to find the specified key, the data `Buffer` for that key (if found) or undefined (if not found). If an offset is specified, the cdb will return data for the *nth* record matching that key.

`getIterator()`

Returns an async iterator (which also implements `AsyncIterable`), for finding multiple values for the same key. This should be slightly faster than calling `get()` with an offset.

`close()`

Closes the file (calls the raw-reader's `close()` function). No more records can be read after closing.

### Custom Raw-Data Reader

You can also implement your own "Raw-Data Reader" (for example, to read data from an online storage bucket).
Such object should have the following fields:
* **required:** async `read(start, length)` function that returns a `Buffer`
* optional: async `open()` function that will be called when the `Readable` is opened
* optional: async `close()` function that will be called when the `Readable` is closed

To use your raw-data reader, pass it as the first param to: `new Readable(myRawDataReader)` (instead of `filename`), or pass it as the first param to `new RawDataReaderCacheWrapper(myRawDataReader)` (instead of `filename`).

### Writable cdb
To create a new Writable instance:

`new require('constant-cdb-customized').Writable(filename);`

You can also pass in options just like Readable. However, unlike raw-data readers, the library **does not** support custom "raw-data writers" (i.e. for writing to an online storage bucket instead of a local file) because creating a constant-db file is more complicated than reading from a constant-db file. In a typical use-case of a **constant database** you would want to create the database file locally, upload it to your online-storage, and use it with your custom raw-data reader.

`open()`

Opens the file for writing. This will overwrite any file that currently exists, or create a new one if necessary.

`put(key, data)`

Writes a record to the cdb.

`close()`

Finalizes the cdb and closes the file. Calling `close()` is necessary to write out the header and subtables required for the cdb!

## Benchmark
`npm run benchmark`
