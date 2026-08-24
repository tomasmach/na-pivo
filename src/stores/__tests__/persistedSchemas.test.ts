import { persistedArray, persistedObject, persistedRecord } from '../persistedSchemas';

describe('persisted schema containers', () => {
  it('keeps compatible arrays and rejects structurally malformed values', () => {
    const valid = [{ id: 'one' }];
    expect(persistedArray(valid)).toBe(valid);
    expect(persistedArray({ 0: valid[0] })).toEqual([]);
    expect(persistedArray(null)).toEqual([]);
  });

  it('keeps compatible records and rejects arrays, null and primitives', () => {
    const valid = { one: { id: 'one' } };
    expect(persistedRecord(valid)).toBe(valid);
    expect(persistedRecord([])).toEqual({});
    expect(persistedRecord(null)).toEqual({});
    expect(persistedRecord('bad')).toEqual({});
  });

  it('gives store merge functions an object even for a malformed root state', () => {
    expect(persistedObject(null)).toEqual({});
    expect(persistedObject([])).toEqual({});
    expect(persistedObject('bad')).toEqual({});
  });
});
