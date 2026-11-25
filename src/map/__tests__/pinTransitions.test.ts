import { clusterIndex } from '../clusterPins';
import { movePins } from '../pinTransitions';

const pins = [
  { id: 'a', lat: 50.0806, lng: 14.428 },
  { id: 'b', lat: 50.0807, lng: 14.4281 },
  { id: 'c', lat: 50.0835, lng: 14.4312 },
];
const groupsAt = clusterIndex(pins);
const TOGETHER = 12;
const APART = 17;

describe('movePins', () => {
  it('lets the pubs of a bubble fly out of it and the bubble fade where it stood', () => {
    const bubble = groupsAt(TOGETHER);
    expect(bubble).toHaveLength(1);
    const shown = movePins(movePins([], bubble), groupsAt(APART));
    const flying = shown.filter((pin) => !pin.leaving);
    expect(flying.map((pin) => pin.node.key).sort()).toEqual(['a', 'b', 'c']);
    for (const pin of flying) expect(pin.from).toBe(bubble[0]);
    const [gone] = shown.filter((pin) => pin.leaving);
    expect(gone.node).toBe(bubble[0]);
    expect(gone.at).toBe(groupsAt(APART).find((node) => node.key === bubble[0].lead.id));
  });

  it('sends pubs into the bubble that takes them', () => {
    const apart = movePins([], groupsAt(APART));
    expect(apart.every((pin) => pin.from === null && !pin.leaving)).toBe(true);
    const [bubble] = groupsAt(TOGETHER);
    const shown = movePins(apart, [bubble]);
    expect(shown.filter((pin) => pin.leaving).map((pin) => pin.at)).toEqual([bubble, bubble, bubble]);
    expect(shown.find((pin) => !pin.leaving)).toEqual({ node: bubble, at: bubble, from: apart.find((pin) => pin.node.lead === bubble.lead)?.at, leaving: false });
  });

  it('keeps untouched markers as they are', () => {
    const apart = movePins([], groupsAt(APART));
    const again = movePins(apart, groupsAt(APART));
    expect(again).toEqual(apart);
    for (const [i, pin] of again.entries()) expect(pin).toBe(apart[i]);
  });

  it('fades a pub that is no longer on the map where it stood', () => {
    const apart = movePins([], groupsAt(APART));
    const [gone] = movePins(apart, groupsAt(APART).slice(1)).filter((pin) => pin.leaving);
    expect(gone.at).toBe(apart[0].at);
  });
});

describe('movePins after a reload', () => {
  it('keeps every marker when the reloaded pubs are the same', () => {
    const shown = movePins([], groupsAt(TOGETHER));
    expect(movePins(shown, clusterIndex(pins)(TOGETHER))[0]).toBe(shown[0]);
  });
});
