/** Validate shared locations before committing any references to a project. */
export function validateFilmLocations(plan, scenes) {
  if (!Array.isArray(plan.locations) || !plan.locations.length) throw Error('缺少共享地点设定');
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const covered = new Set();
  const locationIds = new Set();
  for (const location of plan.locations) {
    if (!location.id || locationIds.has(location.id) || !location.sceneIds?.length ||
        !location.sceneIds.includes(location.masterSceneId) || !location.anchors?.length ||
        typeof location.layout !== 'string') throw Error('地点身份、主视图或空间锚点无效');
    locationIds.add(location.id);
    for (const id of location.sceneIds) {
      if (!sceneIds.has(id) || covered.has(id)) throw Error('场景归属重复或不存在');
      covered.add(id);
    }
    for (const connection of location.connections || []) {
      if (!location.sceneIds.includes(connection.from) || !location.sceneIds.includes(connection.to) ||
          typeof connection.description !== 'string') throw Error('场景连接路径无效');
    }
  }
  if (covered.size !== sceneIds.size) throw Error('地点设定遗漏场景');
}

export function applyFilmLocations(project, plan) {
  validateFilmLocations(plan, project.scenes);
  project.locations = plan.locations;
  project.locationPlanVersion = 1;
  project.locationSceneIds = project.scenes.map(scene => scene.id).sort().join(',');
  for (const location of plan.locations) {
    const masterId = location.masterSceneId + '-environment';
    const constraint = `共享地点 ${location.name || location.id}。固定空间：${location.layout}。固定建筑及地标：${location.anchors.join('；')}。区域连接：${JSON.stringify(location.connections || [])}。仅改变当前区域机位、昼夜光照，禁止重新设计共同建筑、门岗、外墙和道路。`;
    for (const sceneId of location.sceneIds) {
      const scene = project.scenes.find(item => item.id === sceneId);
      scene.locationId = location.id;
      const resource = project.resources.find(item => item.id === sceneId + '-environment');
      if (!resource) continue;
      resource.locationId = location.id;
      resource.locationConstraint = constraint;
      resource.dependencies = [...new Set([...(resource.dependencies || []).filter(id =>
        !project.resources.some(item => item.id === id && item.type === 'environment')),
      ...(sceneId === location.masterSceneId ? [] : [masterId])])];
    }
  }
  for (const shot of project.shots || []) {
    const location = plan.locations.find(item => item.sceneIds.includes(shot.sceneId));
    if (!location) continue;
    shot.locationId = location.id;
    const masterId = location.masterSceneId + '-environment';
    shot.resourceIds = [...new Set([...(shot.resourceIds || []), masterId])];
  }
}

export function filmSettingGroups(resources) {
  const pending = new Set(resources);
  const groups = [];
  while (pending.size) {
    const group = [...pending].filter(resource => !(resource.dependencies || []).some(id =>
      [...pending].some(item => item.id === id)));
    if (!group.length) throw Error('设定图依赖存在循环');
    groups.push(group);
    group.forEach(resource => pending.delete(resource));
  }
  return groups;
}
