'use strict';

let assert = require('assert');
let co = require('co');
let migration = require('../');
let monogram = require('monogram');

describe('migration', function() {
  let schema;
  let User;

  before(function(done) {
    co(function*() {
      let db = yield monogram('mongodb://localhost:27017');

      schema = new monogram.Schema({
        name: {
          first: { $type: String },
          last: { $type: String }
        }
      });

      migration(schema);

      User = db.model({ collection: 'users', schema: schema });

      yield User.deleteMany({});

      done();
    }).catch((error) => done(error));
  });

  it('findOne middleware', function(done) {
    co(function*() {
      schema.migrate(function*(next) {
        let name = this.name;
        let split = name.indexOf(' ');
        this.name = {
          first: split === -1 ? name : name.substr(0, split),
          last: split === -1 ? '' : name.substr(split + 1)
        };
        yield next;
      });

      yield User.insertMany([
        { name: 'Axl Rose' },
        { name: 'Slash' }
      ]);

      let user = yield User.findOne({ name: 'Axl Rose' });
      assert.deepEqual(user.name, { first: 'Axl', last: 'Rose' });
      assert.equal(user.__schemaVersion, 1);

      user = yield User.findOne({ name: 'Slash' });
      assert.deepEqual(user.name, { first: 'Slash', last: '' });
      assert.equal(user.__schemaVersion, 1);

      let raw = yield User.db().collection('users').find().
        sort({ 'name.first': 1 }).toArray();
      assert.equal(raw.length, 2);
      assert.deepEqual(raw[0].name, { first: 'Axl', last: 'Rose' });
      assert.deepEqual(raw[1].name, { first: 'Slash', last: '' });

      done();
    }).catch((error) => done(error));
  });

  it('migrateAll', function(done) {
    co(function*() {
      schema.migrate(function*(next) {
        let query = { 'name.first': { $lt: this.name.first } };
        let count = yield User.count(query);
        this.order = count;
        yield next;
      });

      yield User.migrateAll();
      let raw = yield User.db().collection('users').find().
        sort({ 'name.first': 1 }).toArray();

      assert.equal(raw.length, 2);
      assert.deepEqual(raw[0].name, { first: 'Axl', last: 'Rose' });
      assert.equal(raw[0].order, 0);
      assert.equal(raw[0].__schemaVersion, 2);
      assert.deepEqual(raw[1].name, { first: 'Slash', last: '' });
      assert.equal(raw[1].order, 1);
      assert.equal(raw[0].__schemaVersion, 2);
      done();
    }).catch((error) => done(error));
  });

  it('new documents have latest schema version', function(done) {
    co(function*() {
      let izzy = new User({ name: { first: 'Izzy', last: 'Stradlin' } });
      assert.equal(izzy.__schemaVersion, 2);

      izzy.__schemaVersion = 1;
      yield izzy.$migrate();

      assert.equal(izzy.__schemaVersion, 2);
      assert.equal(izzy.order, 1);

      done();
    }).catch((error) => done(error));
  });
});
