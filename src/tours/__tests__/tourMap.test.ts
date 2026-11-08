import { tourFitCoordinates } from '../TourMap';

const stop = (lat: number, lon: number) => ({ id: `${lat},${lon}`, pubId: '1', cacheKey: null, name: 'Pub', address: 'Prague', lat, lon });

describe('tourFitCoordinates', () => {
  it('widens a lone stop so the map does not zoom to a blank surface', () => {
    const fit = tourFitCoordinates([stop(50.08, 14.42)]);
    const lats = fit.map((c) => c.latitude);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(0.002);
    expect(fit[0]).toEqual({ latitude: 50.08, longitude: 14.42 });
  });
  it('fits a real route as is', () => {
    const stops = [stop(50.08, 14.42), stop(50.09, 14.43)];
    expect(tourFitCoordinates(stops)).toEqual(stops.map((s) => ({ latitude: s.lat, longitude: s.lon })));
  });
});
