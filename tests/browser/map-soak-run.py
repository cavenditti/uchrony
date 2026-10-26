"""Drive real browser drags and keyboard zoom through agent-browser for a bounded soak.

Start the production soak fixture, set its viewport to 1440x1000, select speed,
and press Play first. This runner never loads or replaces a world.
"""

import argparse
import json
import math
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--session', required=True)
parser.add_argument('--minutes', type=float, default=20)
parser.add_argument('--output', required=True)
parser.add_argument('--inspect', action='store_true', help='Exercise an already-open representative-day panel during the run')
parser.add_argument('--max-world-gap-seconds', type=float, default=30,
                    help='Declared largest-world update budget; recorded with the result, never inferred from measured failures')
parser.add_argument('--collect-budget-misses', action='store_true',
                    help='Complete the duration while recording timing failures; does not turn those failures into a pass')
args = parser.parse_args()
output = pathlib.Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)


def command(*parts, commands=None):
    proc = subprocess.run(
        ['agent-browser', '--session', args.session, '--json', *parts],
        input=json.dumps(commands) if commands is not None else None,
        capture_output=True, text=True, timeout=55,
    )
    if proc.returncode:
        raise RuntimeError(proc.stdout + proc.stderr)
    result = json.loads(proc.stdout)
    if isinstance(result, dict) and not result.get('success', True):
        raise RuntimeError(str(result))
    if isinstance(result, list) and any(not item.get('success', True) for item in result):
        raise RuntimeError(str([item for item in result if not item.get('success', True)]))
    return result


def sample():
    value = command('eval', 'window.__uchronySoak.snapshot()')['data']['result']
    with (output / 'samples.jsonl').open('a') as stream:
        stream.write(json.dumps(value) + '\n')
    return value


started = time.monotonic()
next_sample = 0
cycle = 0
failure = None
budget_misses = []
try:
    initial = command('eval', 'window.__uchronySoak.begin()')['data']['result']
    (output / 'initial.json').write_text(json.dumps(initial, indent=2))
    assert initial['world']['cells'] == 129024, 'Expected the largest map'
    assert initial['running'] and initial['mode'] == 'relief', 'Expected running 3D simulation'
    if args.inspect:
        assert command('eval', '!!document.querySelector(".local-inspection")')['data']['result']
    started = time.monotonic()
    while time.monotonic() - started < args.minutes * 60:
        # Two complete, opposite drags, with real intermediate mouse events.
        # Vary the path and zoom direction; fit periodically to keep land in view.
        commands = []
        dx = 200 * math.cos(cycle * .7)
        dy = 120 * math.sin(cycle * .7)
        for sign in [1, -1]:
            commands += [['mouse', 'move', '720', '440'], ['mouse', 'down']]
            for step in range(1, 17):
                commands.append(['mouse', 'move', str(round(720 + sign * dx * step / 16)),
                                 str(round(440 + sign * dy * step / 16))])
            commands.append(['mouse', 'up'])
        commands.append(['mouse', 'move', '720', '440'])
        # A drag focuses the map. Use its real keyboard zoom controls so an
        # autosave-error toast cannot intercept the zoom-button click.
        zoom_period = 36 if args.inspect else 12
        commands.append(['press', '+' if cycle % zoom_period < zoom_period // 2 else '-'])
        # Inspection starts over a populated place: keep that anchor and traverse
        # street-to-region scale repeatedly rather than refitting to an empty ocean.
        if not args.inspect and cycle % 32 == 31:
            commands.append(['press', 'Home'])
        if args.inspect and cycle % 8 == 0:
            commands.append(['click', '[aria-label="Refresh local inspection"]'])
        result = command('batch', '--bail', commands=commands)
        (output / 'last-input-result.json').write_text(json.dumps(result))
        cycle += 1
        elapsed = time.monotonic() - started
        if elapsed >= next_sample:
            state = sample()
            print(json.dumps({'wallSeconds': round(elapsed, 1), 'cycle': cycle,
                              'month': state['world']['month'], 'heapMiB': state['heapMiB'],
                              'frames': state['counters']['frames'], 'p95ms': state['frameMs']['p95'],
                              'drags': state['counters']['pointerUp'], 'wheels': state['counters']['wheels'],
                              'zoomActions': cycle, 'scale': state['scale'],
                              'saves': state['counters']['saves'], 'errors': len(state['errors'])}), flush=True)
            assert state['runId'] == initial['runId'], 'Page reloaded during the run'
            assert state['running'], 'Simulation stopped'
            assert state['mode'] == 'relief', '3D renderer was lost'
            assert not state['errors'], 'Runtime, worker, or save error: ' + str(state['errors'])
            assert not state['counters']['contextLost'], 'Graphics context lost'
            if elapsed >= args.max_world_gap_seconds:
                if state['lastWorldAgoMs'] >= args.max_world_gap_seconds * 1000:
                    message = f'Simulation exceeded the declared {args.max_world_gap_seconds:g}-second update budget'
                    budget_misses.append({'seconds': elapsed, 'kind': 'publication', 'gapMs': state['lastWorldAgoMs']})
                    if not args.collect_budget_misses:
                        raise AssertionError(message)
            if elapsed >= 90:
                if state['lastSaveAgoMs'] >= 90000:
                    budget_misses.append({'seconds': elapsed, 'kind': 'save', 'gapMs': state['lastSaveAgoMs']})
                    if not args.collect_budget_misses:
                        raise AssertionError('No successful save for 90 seconds')
            next_sample = elapsed + 15
except (Exception, KeyboardInterrupt) as error:
    failure = str(error) or 'Interrupted before completing the requested duration'
    print(json.dumps({'failure': failure}), flush=True)
finally:
    final = {'wallSeconds': time.monotonic() - started, 'cycles': cycle, 'failure': failure, 'inspection': args.inspect,
             'budgets': {'worldGapSeconds': args.max_world_gap_seconds, 'saveGapSeconds': 90},
             'budgetMisses': budget_misses, 'collectBudgetMisses': args.collect_budget_misses}
    try:
        command('mouse', 'up')
        final['state'] = sample()
        command('screenshot', str(output / 'final.png'))
        if final['state']['running']:
            command('click', '[aria-label="Pause simulation"]')
        final['paused'] = sample()
        final['browserErrors'] = command('errors')
        final['console'] = command('console')
    except Exception as error:
        final['cleanupError'] = str(error)
    (output / 'result.json').write_text(json.dumps(final, indent=2))
    print(json.dumps({'completed': final['wallSeconds'], 'cycles': cycle, 'failure': failure}), flush=True)
if failure or final.get('state', {}).get('errors') or budget_misses:
    raise SystemExit(1)
