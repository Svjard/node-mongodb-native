var BaseCommand = require('./base_command').BaseCommand,
  inherits = require('util').inherits;

/**
  Insert Document Command
**/
var DeleteCommand = exports.DeleteCommand = function(db, collectionName, selector, flags) {
  BaseCommand.call(this);

  // Validate correctness off the selector
  var object = selector;
  if(Buffer.isBuffer(object)) {
    var object_size = object[0] | object[1] << 8 | object[2] << 16 | object[3] << 24;        
    if(object_size != object.length)  {
      var error = new Error("delete raw message size does not match message header size [" + object.length + "] != [" + object_size + "]");
      error.name = 'MongoError';
      throw error;
    }
  }
  
  this.flags = flags;
  this.collectionName = collectionName;
  this.selector = selector;
  this.db = db;
};

inherits(DeleteCommand, BaseCommand);

DeleteCommand.OP_DELETE =	2006;

/*
struct {
    MsgHeader header;                 // standard message header
    int32     ZERO;                   // 0 - reserved for future use
    cstring   fullCollectionName;     // "dbname.collectionname"
    int32     ZERO;                   // 0 - reserved for future use
    mongo.BSON      selector;               // query object.  See below for details.
}
*/
DeleteCommand.prototype.toBinary = function(bsonSettings) {
  // Validate that we are not passing 0x00 in the colletion name
  if(!!~this.collectionName.indexOf("\x00")) {
    throw new Error("namespace cannot contain a null character");
  }

  // Calculate total length of the document
  var totalLengthOfCommand = 4 + Buffer.byteLength(this.collectionName) + 1 + 4 + this.db.bson.calculateObjectSize(this.selector, false, true) + (4 * 4);
  
  // Enforce maximum bson size
  if(!bsonSettings.disableDriverBSONSizeCheck 
    && totalLengthOfCommand > bsonSettings.maxBsonSize) 
    throw new Error("Document exceeds maximum allowed bson size of " + bsonSettings.maxBsonSize + " bytes");

  if(bsonSettings.disableDriverBSONSizeCheck 
    && totalLengthOfCommand > bsonSettings.maxMessageSizeBytes) 
    throw new Error("Command exceeds maximum message size of " + bsonSettings.maxMessageSizeBytes + " bytes");

  // Let's build the single pass buffer command
  var _index = 0;
  var _command = new Buffer(totalLengthOfCommand);
  // Write the header information to the buffer
  _command[_index + 3] = (totalLengthOfCommand >> 24) & 0xff;     
  _command[_index + 2] = (totalLengthOfCommand >> 16) & 0xff;
  _command[_index + 1] = (totalLengthOfCommand >> 8) & 0xff;
  _command[_index] = totalLengthOfCommand & 0xff;
  // Adjust index
  _index = _index + 4;
  // Write the request ID
  _command[_index + 3] = (this.requestId >> 24) & 0xff;     
  _command[_index + 2] = (this.requestId >> 16) & 0xff;
  _command[_index + 1] = (this.requestId >> 8) & 0xff;
  _command[_index] = this.requestId & 0xff;
  // Adjust index
  _index = _index + 4;
  // Write zero
  _command[_index++] = 0;
  _command[_index++] = 0;
  _command[_index++] = 0;
  _command[_index++] = 0;
  // Write the op_code for the command
  _command[_index + 3] = (DeleteCommand.OP_DELETE >> 24) & 0xff;     
  _command[_index + 2] = (DeleteCommand.OP_DELETE >> 16) & 0xff;
  _command[_index + 1] = (DeleteCommand.OP_DELETE >> 8) & 0xff;
  _command[_index] = DeleteCommand.OP_DELETE & 0xff;
  // Adjust index
  _index = _index + 4;

  // Write zero
  _command[_index++] = 0;
  _command[_index++] = 0;
  _command[_index++] = 0;
  _command[_index++] = 0;

  // Write the collection name to the command
  _index = _index + _command.write(this.collectionName, _index, 'utf8') + 1;
  _command[_index - 1] = 0;    

  // Write the flags
  _command[_index + 3] = (this.flags >> 24) & 0xff;     
  _command[_index + 2] = (this.flags >> 16) & 0xff;
  _command[_index + 1] = (this.flags >> 8) & 0xff;
  _command[_index] = this.flags & 0xff;
  // Adjust index
  _index = _index + 4;

  // Document binary length
  var documentLength = 0

  // Serialize the selector
  // If we are passing a raw buffer, do minimal validation
  if(Buffer.isBuffer(this.selector)) {
    documentLength = this.selector.length;
    // Copy the data into the current buffer
    this.selector.copy(_command, _index);
  } else {
    documentLength = this.db.bson.serializeWithBufferAndIndex(this.selector, false, _command, _index) - _index + 1;
  }
  
  // Write the length to the document
  _command[_index + 3] = (documentLength >> 24) & 0xff;     
  _command[_index + 2] = (documentLength >> 16) & 0xff;
  _command[_index + 1] = (documentLength >> 8) & 0xff;
  _command[_index] = documentLength & 0xff;
  // Update index in buffer
  _index = _index + documentLength;
  // Add terminating 0 for the object
  _command[_index - 1] = 0;      
  return _command;
};