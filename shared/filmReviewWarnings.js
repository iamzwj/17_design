// Identify the current set of review observations, so a later review can notify again.
export function filmReviewTargets(project) {
  const shots = (project.shots || []).filter(shot => shot.review && shot.review.status !== 'pass' && shot.manualApprovedVersion !== (shot.revision || 1))
    .map(shot => ({ id: shot.id, stage: 'storyboard', revision: shot.revision || 1, review: shot.review }))
  const assets = (project.resources || []).filter(asset => asset.assetReview?.status === 'review' && !asset.stale && asset.approvedVersion !== (asset.revision || 1))
    .map(asset => ({ id: asset.id, stage: asset.category, revision: asset.revision || 1, review: asset.assetReview }))
  return [...shots, ...assets]
}
export function filmReviewFingerprint(project) {
  return JSON.stringify({ count: Number(project.reviewWarning) || 0, targets: filmReviewTargets(project) })
}
