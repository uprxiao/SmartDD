import {useEffect,useRef,useState} from 'react';
import {createPreviewConnectionChecks} from './connection-preflight-preview.mjs';
import {ReadControls} from './PrototypeActivity';
// Public synthetic queue only;no provider calls or saved mail text.
export function usePrototypeDraftReads({projectId,review,setReview}){
 const [hold,setHold]=useState(false),[listError,setListError]=useState(false),[detailError,setDetailError]=useState(false),[stats,setStats]=useState({started:0,held:0,ignored:0});
 const [pageLimits,setPageLimits]=useState({[projectId]:50});
 const [listPhase,setListPhase]=useState('ready'),[listBusy,setListBusy]=useState(false),[detailPhase,setDetailPhase]=useState('ready');
 const live=useRef(true),queue=useRef(null),currentProject=useRef(projectId),lastProject=useRef(projectId),cache=useRef(new Map([[projectId,{phase:'ready',generation:0}]])),listGeneration=useRef(0),detailGeneration=useRef(0),selected=useRef(null);
 currentProject.current=projectId;if(!queue.current)queue.current=createPreviewConnectionChecks(setStats);
 useEffect(()=>{live.current=true;return()=>{live.current=false;listGeneration.current++;detailGeneration.current++;queue.current.dispose();};},[]);
 const readList=(nextPage=false)=>{const project=projectId,attempt=++listGeneration.current,limit=(pageLimits[projectId]??50)+(nextPage?50:0),background=cache.current.get(project)?.phase==='ready',failed=listError;setListError(false);setListBusy(true);setListPhase(background?'ready':'loading');cache.current.set(project,{phase:background?'ready':'loading',generation:attempt});queue.current.request(()=>{if(live.current&&cache.current.get(project)?.generation===attempt){cache.current.set(project,{phase:failed?'error':'ready',generation:attempt});if(!failed)setPageLimits(previous=>({...previous,[project]:limit}));}if(!live.current||attempt!==listGeneration.current||currentProject.current!==project)return false;setListBusy(false);setListPhase(failed?'error':'ready');return true;},{hold});};
 const refresh=()=>readList();
 const loadMore=()=>{if(!listBusy&&listPhase==='ready')readList(true);};
 const close=()=>{detailGeneration.current++;selected.current=null;setReview(null);setDetailPhase('ready');};
 const open=value=>{const project=projectId,attempt=++detailGeneration.current,failed=detailError;selected.current={project,id:value.id,revision:value.revision};setDetailError(false);setReview(value);setDetailPhase('loading');queue.current.request(()=>{if(!live.current||attempt!==detailGeneration.current||currentProject.current!==project||selected.current?.id!==value.id||selected.current?.revision!==value.revision)return false;setDetailPhase(failed?'error':'ready');return true;},{hold});};
 useEffect(()=>{if(lastProject.current===projectId)return;lastProject.current=projectId;if(selected.current&&selected.current.project!==projectId)close();refresh();},[projectId]);
 useEffect(()=>{if(review)return;detailGeneration.current++;selected.current=null;},[review]);
 const changedProject=lastProject.current!==projectId;
 return{pageLimit:pageLimits[projectId]??50,loadMore,listPhase:changedProject?(cache.current.get(projectId)?.phase==='ready'?'ready':'loading'):listPhase,listBusy:changedProject||listBusy,detailPhase,open,close,refresh,showModalControls:hold||stats.held>0||listError||detailError,controls:{hold,setHold,listError,setListError,detailError,setDetailError,stats,release:()=>queue.current.release()}};
}
export function DraftReadControls({owner,modal=false}){if(modal&&!owner.showModalControls)return null;return <ReadControls className="m10-draft-read-preview" {...owner.controls}/>;}
