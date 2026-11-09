# Beck et al.(2023) 0.1° 1991~2020 월평균 기온·강수(CC BY 4.0)에서 지점 값을 뽑는다.
# python scripts/beck-points.py <ensemble_mean_0p1.nc> <points.json [{name,lat,lon}]> <out.json>
import sys, json, h5py, numpy as np
nc, pts, out = sys.argv[1:4]
f = h5py.File(nc, 'r')
T, P = f['air_temperature'], f['precipitation']
res = {}
for p in json.load(open(pts, encoding='utf-8')):
    i = int((89.95 - p['lat']) / 0.1 + 0.5); j = int((p['lon'] + 179.95) / 0.1 + 0.5)
    best = None
    for r in range(0, 4):  # 바다 칸이면 가까운 육지 칸(최대 3칸)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                ii, jj = min(max(i + di, 0), 1799), (j + dj) % 3600
                t = T[:, ii, jj]
                if np.all(t > -9000):
                    d = di * di + dj * dj
                    if best is None or d < best[0]: best = (d, ii, jj)
        if best: break
    if not best: res[p['name']] = None; continue
    _, ii, jj = best
    res[p['name']] = {'temp': [round(float(v), 1) for v in T[:, ii, jj]], 'precip': [round(float(v), 1) for v in P[:, ii, jj]], 'cellLat': round(float(f['lat'][ii]), 2), 'cellLon': round(float(f['lon'][jj]), 2)}
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
print('지점', len(res))
