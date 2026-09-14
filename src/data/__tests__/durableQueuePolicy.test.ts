import { preserveDurableQueue } from '../durableQueuePolicy';

describe('durable queue capacity', () => {
  it('never evicts an accepted offline operation', () => {
    const pending = ['oldest', 'middle', 'newest'];

    expect(preserveDurableQueue(pending, 2)).toEqual(pending);
  });
});
