const A = 6378245; const EE = 0.006693421622965943;
export function wgs84ToGcj02(lon, lat) {
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lon, lat];
  const x = lon - 105; const y = lat - 35;
  let dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
  dlat += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
  dlat += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;
  dlat += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  let dlon = 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dlon += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
  dlon += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;
  dlon += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
  const rad = lat/180*Math.PI; const magic = 1-EE*Math.sin(rad)**2;
  return [lon+dlon*180/(A/Math.sqrt(magic)*Math.cos(rad)*Math.PI), lat+dlat*180/((A*(1-EE))/(magic*Math.sqrt(magic))*Math.PI)];
}
export function distanceToPaths(point, paths) {
  const sx = 111320*Math.cos(point[1]*Math.PI/180); const sy = 111320; let best = Infinity;
  for (const path of paths) for (let i=1;i<path.length;i++) {
    const ax=(path[i-1][0]-point[0])*sx, ay=(path[i-1][1]-point[1])*sy, bx=(path[i][0]-point[0])*sx, by=(path[i][1]-point[1])*sy;
    const dx=bx-ax, dy=by-ay, t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy || 1)));
    best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return best;
}
export function evaluatePosition(sample, paths, previous = 0, now = Date.now()) {
  if (!sample || !Number.isFinite(sample.accuracy) || !Number.isFinite(sample.timestamp) || sample.timestamp > now + 5000 || now-sample.timestamp > 15000) return { streak:0, quality:'stale', offRoute:false };
  if (sample.accuracy > 30 || sample.accuracy < 0) return { streak:0, quality:'poor', offRoute:false };
  if (!paths.some(path => path.length > 1)) return { streak:0, quality:'no-route', offRoute:false };
  const distance = distanceToPaths(sample.point, paths); const streak = distance > Math.max(40,2*sample.accuracy) ? previous+1 : 0;
  return { streak, quality:'good', offRoute:streak>=3 };
}
export function remainingDistance(route, index) {
  const segments=route?.segments || []; const total=Number(route?.distance_m || 0);
  const lengths=segments.map(s=>Number(s.length_m ?? s.distance_m ?? 0));
  const sum=lengths.reduce((a,b)=>a+b,0);
  const fraction=sum>0 ? lengths.slice(index).reduce((a,b)=>a+b,0)/sum : segments.length ? (segments.length-index)/segments.length : 1;
  return Math.max(0,Math.round(total*fraction));
}
