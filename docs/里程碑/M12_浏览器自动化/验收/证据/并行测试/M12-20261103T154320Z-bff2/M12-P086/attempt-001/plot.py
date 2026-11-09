from pathlib import Path
import json,os
root=Path(__file__).parent;os.environ['MPLCONFIGDIR']=str(root/'cache/matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
raw=json.loads((root/'raw.json').read_text());cpu=json.loads((root/'cpu-analysis.json').read_text());judge=json.loads((root/'adjudication.json').read_text());points=raw['milestones'];x=[p['before']['elapsedSeconds']/60 for p in points];rss=[p['before']['rssTotalBytes']/2**20 for p in points]
fig,axes=plt.subplots(2,1,figsize=(11,7),sharex=True,constrained_layout=True)
axes[0].plot(x,rss,'o-',label='App aggregate RSS (shared pages counted per process)');
if '10'in judge['rssMilestoneBytes']:axes[0].axhline(judge['rssMilestoneBytes']['10']/2**20*1.10,color='#d97706',linestyle='--',label='110% of minute10 RSS')
axes[0].set_ylabel('Resident memory (MiB)');axes[0].legend(fontsize=8);axes[0].grid(alpha=.25)
valid=[v for v in cpu['intervals']if v['idle']and v['complete']];axes[1].plot([p['endElapsedSeconds']/60 for p in valid],[p['oneCorePercent']for p in valid],'.-',markersize=2,linewidth=.7,label='Actual idle interval CPU');axes[1].axhline(5,color='#dc2626',linestyle='--',label='5% of one logical core');axes[1].set_ylabel('App CPU (%; one core = 100%)');axes[1].set_xlabel('Elapsed monotonic time (minutes)');axes[1].grid(alpha=.25);axes[1].legend(fontsize=8)
anchor=int(raw.get('measurementStartMonoNs',0))
for region in raw['activityRanges']if anchor else []:
 start=(int(region['startMonoNs'])-anchor)/60e9;end=(int(region.get('endMonoNs',region['startMonoNs']))-anchor)/60e9
 if end>=0:
  for ax in axes:ax.axvspan(max(0,start),end,color='#9ca3af',alpha=.2)
fig.suptitle('M12 T111: five real parked pages, actual OS RSS / cumulative CPU differences\n'+raw.get('measurementStartedAtUtc','Measurement not started')+' | gray: real command activity, excluded from idle CPU')
fig.savefig(root/'resource-curve.png',dpi=160);fig.savefig(root/'resource-curve.svg');plt.close(fig)
print('saved resource-curve.png and resource-curve.svg from preserved raw values')
