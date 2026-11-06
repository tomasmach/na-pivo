import { visiblePins } from '../visiblePins';

const region = { latitude: 50, longitude: 14, latitudeDelta: 0.02, longitudeDelta: 0.02 };

it('keeps pins on screen and leaves out the strip under the search bar and the area outside', () => {
  const pins = [
    { key: 'under-search', lat: 50.009, lng: 14 },
    { key: 'middle', lat: 50, lng: 14.009 },
    { key: 'bottom', lat: 49.992, lng: 14 },
    { key: 'east', lat: 50, lng: 14.02 },
    { key: 'south', lat: 49.98, lng: 14 },
  ];

  expect(visiblePins(pins, region, 800, 200).map((p) => p.key)).toEqual(['middle', 'bottom']);
  expect(visiblePins(pins, region, 800, 0).map((p) => p.key)).toEqual(['under-search', 'middle', 'bottom']);
});
