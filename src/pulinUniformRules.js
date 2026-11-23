export function maleUniformAccessory(seasonId) {
  const base = '使用男款制服。领口只佩戴一条金色行政长领带，禁止领花和蝴蝶结。';
  return seasonId.startsWith('summer')
    ? base + '领带自然垂在衬衫前，长度到腰带附近。'
    : base + '外套前襟自然合拢并扣好，领带位于衬衫与外套之间。只露出领结及胸前V形领口内的上半段；领带下半段和尖端必须被西装前襟遮住，收在衣服里面。冬季领带还须位于大衣内侧。禁止外套敞开导致整条领带外露，禁止领带压在西装或大衣外面，禁止金色领带尖端露在腰腹部。';
}
