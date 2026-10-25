"""Summarize a completed map soak without treating an interrupted run as a pass."""
import argparse
import json
from datetime import datetime
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
root = args.directory
read = lambda name: json.loads((root / name).read_text())
lines = lambda name: [json.loads(line) for line in (root / name).read_text().splitlines()]
result, initial = read('result.json'), read('initial.json')
samples = lines('samples.jsonl')
state = result.get('state', {})
counters = state.get('counters', {})
errors = [e for s in samples for e in s.get('errors', [])]
checks = {
    'full20Minutes': result['wallSeconds'] >= 1200,
    'completedWithoutFailure': not result.get('failure') and not result.get('cleanupError'),
    'largestMap': state.get('world', {}).get('cells') == 129024,
    'samePage': all(s['runId'] == initial['runId'] for s in samples),
    'runningThroughout': all(s['running'] for s in samples[:-1]),
    'reliefThroughout': all(s['mode'] == 'relief' for s in samples),
    'noRuntimeOrSaveErrors': not errors,
    'noGraphicsLoss': counters.get('contextLost') == 0,
    'simulationAdvanced': state.get('world', {}).get('month', 0) - initial['world']['month'] >= 24,
    'substantialRealInput': counters.get('pointerUp', 0) >= 1000 and result['cycles'] >= 500,
    'regularReplicatedSaves': all(
        s['lastSaveAgoMs'] < 90000 and set(s['world'].get('replicas', [])) == {'disk', 'browser'}
        for s in samples if s['elapsedMs'] >= 90000
    ),
}
memory = lines('process-memory.jsonl') if (root / 'process-memory.jsonl').exists() else []
start_time = datetime.fromisoformat(initial['timestamp'].replace('Z', '+00:00')).timestamp()
end_time = datetime.fromisoformat(state.get('timestamp', initial['timestamp']).replace('Z', '+00:00')).timestamp()
memory = [s for s in memory if start_time <= s['time'] <= end_time]
renderer = [max((p['rssMiB'] for p in s['processes'] if p['role'] == 'renderer'), default=0) for s in memory]
renderer = [value for value in renderer if value > 0]
summary = {
    'passed': all(checks.values()), 'checks': checks,
    'wallSeconds': result['wallSeconds'], 'seed': 'A world unwritten',
    'startMonth': initial['world']['month'], 'endMonth': state.get('world', {}).get('month'),
    'drags': min(counters.get('pointerDown', 0), counters.get('pointerUp', 0)),
    'keyboardZoomActions': result['cycles'],
    'saves': counters.get('saves'), 'saveMiB': state.get('world', {}).get('saveBytes', 0) / 1024**2,
    'longestSampledSaveGapSeconds': max(s['lastSaveAgoMs'] for s in samples if s['elapsedMs'] >= 90000) / 1000,
    'frameMs': state.get('frameMs'), 'framesOverOneSecond': counters.get('over1000ms'),
    'mainPageHeapPeakMiB': max(s.get('heapMiB', 0) or 0 for s in samples),
    'mainPageHeapFinalMiB': state.get('heapMiB'),
    'rendererPeakRssMiB': max(renderer, default=None), 'rendererLastRssMiB': renderer[-1] if renderer else None,
    'gpu': state.get('gpu'),
}
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
if not summary['passed']:
    raise SystemExit(1)
