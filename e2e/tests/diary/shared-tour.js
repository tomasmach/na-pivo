/* global output, STAGE */
function verify() {
  const state = output.local.state().scenario;
  const check = output.local.check;
  check(state.plans.length === 1 && state.drinks.length === 0, 'Sharing must retain exactly one plan and no counted drinks.');
  const plan = state.plans[0];
  check(plan.title === 'E2E Sdílená tour' && JSON.stringify(plan.stops.map(function(s) { return s.name; })) === JSON.stringify(['E2E U Testera','E2E Druhá hospoda']), 'The real shared plan must retain both ordered stops.');
  check(state.shares.length === 1, 'Expected exactly one private capability.');
  if (STAGE === 'private') {
    output.sharedPlan = plan.id;
    check(output.local.request('/capability/status', { name:'private-tour' }).status === 200, 'Private copied link must open the real plan.');
  } else {
    check(plan.id === output.sharedPlan, 'Publishing and withdrawing must preserve the original server plan identity.');
    check(state.publications.length === 1, 'Expected one real public publication after submit; observed ' + state.publications.length + '.');
    const publication = state.publications[0];
    check(JSON.stringify(publication.stopNames) === JSON.stringify(['E2E U Testera','E2E Druhá hospoda']) && publication.snapshotKeys.indexOf('scheduled_date') === -1 && publication.snapshotKeys.indexOf('scheduled_time') === -1, 'Public snapshot must retain ordered stops and exclude meetup fields.');
    if (STAGE === 'public' || STAGE === 'links') check(publication.status === 'active' && state.shares[0].revoked_at === null, 'Public and private capabilities must be active.');
    else {
      check(publication.status === 'unpublished' && state.shares[0].revoked_at !== null, 'Both capabilities must be withdrawn without deleting the plan.');
      ['private-tour','public-tour'].forEach(function(name) { check(output.local.request('/capability/status', { name:name }).status === 404, 'Withdrawn capability must return 404.'); });
    }
  }
  if (STAGE === 'links') {
    const capability = output.local.request('/capability/status', { name: 'public-tour', distinctFrom: 'private-tour' });
    check(capability.status === 200 && capability.distinct === true, 'The copied public capability must open and differ from the private capability.');
  }
}
output.local.poll(verify, 15000);
