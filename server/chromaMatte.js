// Remove the screen color from RGB as well as alpha; alpha-only keys leave halos.
export function cleanChromaPixels(data, key) {
  const dominant = key.indexOf(Math.max(...key));
  const others = [0,1,2].filter(channel=>channel!==dominant);
  const saturated = key[dominant] - Math.max(...others.map(channel=>key[channel])) > 100;
  for(let offset=0;offset<data.length;offset+=4){
    const distance=key.reduce((sum,value,channel)=>sum+(data[offset+channel]-value)**2,0);
    const alpha=Math.max(0,Math.min(1,(distance-46**2)/(168**2-46**2)));
    if(alpha===0){data.fill(0,offset,offset+4);continue;}
    if(alpha<1){
      for(let channel=0;channel<3;channel++)data[offset+channel]=Math.max(0,Math.min(255,Math.round((data[offset+channel]-key[channel]*(1-alpha))/alpha)));
      data[offset+3]=Math.round(data[offset+3]*alpha);
    }
    // Suppress screen spill on dark hair and fabric even when the matte is opaque.
    if(saturated){
      const neutral=Math.max(...others.map(channel=>data[offset+channel]));
      data[offset+dominant]=Math.min(data[offset+dominant],neutral);
    }
  }
  return data;
}
