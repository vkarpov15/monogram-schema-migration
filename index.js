'use strict';

let _ = require('lodash');
let co = require('co');
let composition = require('composition');
let debug = require('debug')('monogram:migration');

module.exports = function(schema) {
  schema.path('__schemaVersion', { $type: Number });

  schema.minSchemaVersion = 0;
  schema.migrations = [];
  schema.migrate = function(fn) {
    schema.migrations.push(fn);
  };

  schema.method('model', 'migrate', function(fn) {
    schema.migrate(fn);
  });

  schema.method('model', 'migrateAll', function() {
    return this.find({}).cursor().then((cursor) => {
      return new Promise((resolve, reject) => {
        let numUpdated = 0;
        let state = {
          numOutstanding: 0,
          ended: false
        };

        cursor.on('data', (doc) => {
          debug('migrating');
          debug(doc);
          ++state.numOutstanding;
          co(function*() {
            yield applyMigrations(schema, doc);
            doc.__schemaVersion = schema.migrations.length;
            debug('doc after migration');
            debug(doc);
            yield doc.$save();
            --state.numOutstanding;
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
  });

  schema.method('document', '$migrate', function() {
    return applyMigrations(schema, this).then(() => {
      this.__schemaVersion = schema.migrations.length;
      return Promise.resolve();
    });
  });

  schema.queue(function() {
    if (this.$isNew()) {
      this.__schemaVersion = schema.migrations.length;
    }
  });

  schema.middleware('findOne', function*(next) {
    let doc = yield next;
    yield applyMigrations(schema, doc);
    doc.__schemaVersion = schema.migrations.length;
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
