export function filmLocationReviewTargets(project) {
  return (project.locations || []).flatMap(location => {
    const review = project.locationReviews?.[location.id]
    const ids = [location.masterSceneId, ...location.sceneIds.filter(id => id !== location.masterSceneId)]
    const files = ids.map(id => project.resources?.find(asset => asset.id === id + '-environment' && !asset.stale)?.output?.file)
    if (!review || review.status === 'pass' || files.some(file => !file) || review.key !== JSON.stringify(files)) return []
    return [{ id: location.masterSceneId + '-environment', stage: 'scenes', revision: project.scriptRevision || 1, review }]
  })
}

// Identify the current set of review observations, so a later review can notify again.
export function filmReviewTargets(project) {
  const shots = (project.shots || []).filter(shot => shot.review && shot.review.status !== 'pass' && shot.manualApprovedVersion !== (shot.revision || 1))
    .map(shot => ({ id: shot.id, stage: 'storyboard', revision: shot.revision || 1, review: shot.review }))
  const assets = (project.resources || []).filter(asset => asset.assetReview && ['review', 'repair'].includes(asset.assetReview.status) && !asset.stale && asset.approvedVersion !== (asset.revision || 1))
    .map(asset => ({ id: asset.id, stage: asset.category, revision: asset.revision || 1, review: asset.assetReview }))
  const continuity = project.continuityReview?.status === 'manual'
    ? [{ id: 'continuity', stage: 'storyboard', revision: project.scriptRevision || 1, review: project.continuityReview }]
    : []
  return [...shots, ...assets, ...filmLocationReviewTargets(project), ...continuity]
}
export function filmReviewFingerprint(project) {
  return JSON.stringify({ count: Number(project.reviewWarning) || 0, targets: filmReviewTargets(project) })
}
