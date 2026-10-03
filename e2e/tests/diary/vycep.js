/* global output, STAGE */
function verify() {
  const state = output.local.state().scenario;
  const check = output.local.check;
  check(state.nights.length === 1, 'Offline publication must flush after foreground without an additional restart.');
  const night = state.nights[0];
  check(night.beer_count === 1 && night.visibility === 'friends' && !night.is_removed && JSON.stringify(night.pub_names) === JSON.stringify(['E2E U Testera']), 'Expected one friends-only published night with one beer and the original pub.');
  check(state.drinks.length === 1 && state.visits.length === 1 && state.visits[0].closed_at !== null, 'Publishing must preserve the single counted beer and closed evening.');
  if (STAGE === 'synced') output.night = night;
  else check(JSON.stringify(night) === JSON.stringify(output.night), 'Restart must preserve the same single published night.');
}
if (STAGE === 'persisted') verify();
else {
  try { output.local.poll(verify, 15000); }
  catch (error) {
    output.local.screenshot('diary-vycep-foreground-not-synced');
    throw error;
  }
}
