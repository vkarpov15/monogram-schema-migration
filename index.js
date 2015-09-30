'use strict';

let _ = require('lodash');
let co = require('co');
let composition = require('composition');

module.exports = function(schema) {
  schema._obj['__schemaVersion'] = { $type: Number };

  schema.minSchemaVersion = 0;
  schema.migrations = [];
  schema.migrate = function(fn) {
    schema.migrations.push(fn);
  };

  schema.method('model', 'migrateAll', function() {
    if (!this.schema) {
      return Promise.resolve();
    }

    let schema = this.schema;
    return new Promise((resolve, reject) => {
      let cursor = this.find({}).cursor();
      let numUpdated = 0;
      let state = {
        numOutstanding: 0,
        ended: false
      }
      cursor.on('data', (doc) => {
        ++numOutstanding;
        co(function*() {
          yield applyMigrations(schema, doc);
          yield doc.$save();
          --numOutstanding;
          ++numUpdated
          if (state.ended && state.numOutstanding <= 0) {
            resolve(numUpdated);
          }
        }).catch((error) => { reject(error); });
      });

      cursor.on('error', (error) => {
        reject(error);
      });

      cursor.on('end', () => {
        state.ended = true;
        if (state.numOutstanding <= 0) {
          resolve(numUpdated);
        }
      });
    });
  });

  schema.middleware('findOne', function*(next) {
    let doc = yield next;
    yield applyMigrations(schema, doc);
    yield doc.$save();
    return doc;
  });
};

function applyMigrations(schema, doc) {
  let currentVersion = doc.__schemaVersion || 0;
  if (currentVersion < schema.minSchemaVersion) {
    let errmsg = `Document '${doc._id}' has schema version
      ${currentVersion}, which is less than the minimum schema version
      ${schema.minSchemaVersion}`;
    return Promise.reject(new Error(errmsg));
  }

  return composition(schema.migrations.slice(currentVersion)).call(doc);
}
