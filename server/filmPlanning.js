export async function runFilmPlanning(project, { agents, check, save, event }) {
  if (!project.simpleFilmWorkflow || project.simplePlanningFallback) {
    await agents.director(project);
    return;
  }
  try {
    await agents.simplePlan(project);
  } catch (error) {
    check(project);
    project.simplePlanningFallback = true;
    event(project, 'director', 'simple-plan-fallback', '整片规划暂不可用，自动切换分步规划并保留故事。', {type:'recovery'});
    save(project);
    await agents.director(project);
  }
}
