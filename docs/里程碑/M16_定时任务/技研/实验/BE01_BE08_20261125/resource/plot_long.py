#!/usr/bin/env python3
"""Plot saved checkpoint metrics only. Labels intentionally distinguish synthetic from product."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parent
modes={m:json.loads((root/(m+'-long')/'summary.json').read_text()) for m in ['keep','idle']}
fig,ax=plt.subplots(1,2,figsize=(11,4.2),layout='constrained')
x=list(range(0,31,5)); colors={'keep':'#2a6496','idle':'#13877a'}
for m,s in modes.items():
    values=s['checkpointBeforeWorkingSetKiB'];label=('Keep paintable' if m=='keep' else 'Idle + reacquire')
    ax[0].plot(x,[v/1024 for v in values],marker='o',label=label,color=colors[m]);ax[1].plot(x,[100*v/values[2] for v in values],marker='o',label=label,color=colors[m])
ax[0].set(title='Total Electron working set',xlabel='Elapsed minutes',ylabel='MiB (sum, shared pages may be counted twice)',xticks=x);ax[1].set(title='Normalized to minute 10',xlabel='Elapsed minutes',ylabel='% of minute-10 working set',xticks=x)
ax[1].axhline(110,linestyle='--',linewidth=1.0,color='#b95047',label='110% exploratory limit');ax[1].axvspan(15,30,color='#777777',alpha=.08,label='Last four checkpoints')
for a in ax:a.grid(axis='y',alpha=.24);a.legend(loc='best',fontsize=8,frameon=False)
fig.suptitle('BE08 • two sequential 30-minute synthetic native-view trials\nFixed 5 pages, hidden host; not packaged WillYou or formal M12-T111',fontsize=12)
fig.savefig(root/'long-trend.png',dpi=160,facecolor='white')
