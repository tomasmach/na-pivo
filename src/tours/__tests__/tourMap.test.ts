import { tourFitCoordinates } from '../TourMap';

const stop = (lat: number, lon: number) => ({ id: `${lat},${lon}`, pubId: '1', cacheKey: null, name: 'Pub', address: 'Prague', lat, lon });

describe('tourFitCoordinates', () => {
  it('widens a lone stop east–west so the map does not zoom to a blank surface', () => {
    const fit = tourFitCoordinates([stop(50.08, 14.42)]);
    const lons = fit.map((c) => c.longitude);
    expect(Math.max(...lons) - Math.min(...lons)).toBeCloseTo(0.008);
    expect(new Set(fit.map((c) => c.latitude))).toEqual(new Set([50.08]));
  });
  it('fits a real route as is', () => {
    const stops = [stop(50.08, 14.42), stop(50.09, 14.43)];
    expect(tourFitCoordinates(stops)).toEqual(stops.map((s) => ({ latitude: s.lat, longitude: s.lon })));
  });
});
