from flask import Flask, request, send_file, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from guardian_crosswords import Crossword, get_crossword_data
import os, uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output_files")
STATIC_DIR = os.path.join(BASE_DIR, "dist")
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

PLAYER_COLORS = ['#e05252', '#4a7fd4', '#2d9e5e', '#e08b4a', '#7b2d8b', '#2d9e9e', '#d4497a', '#8b6f2d']

# Per-game in-memory state (lost on server restart)
games = {}          # { game_id: { 'type': str, 'number': int } }
room_states = {}    # { game_id: { "row,col": char } }
game_players = {}   # { game_id: { player_id: { name, color } } }
cell_owners = {}    # { game_id: { "row,col": player_id } }
socket_rooms = {}   # { socket_sid: game_id }  — for leave_room fix


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

@app.route('/api/crossword/<crossword_type>/<int:crossword_number>')
def api_crossword(crossword_type, crossword_number):
    data = get_crossword_data(crossword_type, crossword_number)
    return jsonify(data)


@app.route('/api/game', methods=['POST'])
def create_game():
    body = request.get_json(force=True)
    game_id = str(uuid.uuid4())
    games[game_id] = {'type': body['type'], 'number': body['number']}
    room_states[game_id] = {}
    game_players[game_id] = {}
    cell_owners[game_id] = {}
    return jsonify({'game_id': game_id})


@app.route('/api/game/<game_id>')
def get_game(game_id):
    if game_id not in games:
        return jsonify({'error': 'Game not found'}), 404
    return jsonify(games[game_id])


@app.route('/generate', methods=['POST'])
def generate():
    user_text = request.form.get('user_text')
    user_number = int(request.form.get('user_number'))
    puzzle_dir = os.path.join(OUTPUT_DIR, user_text)
    filename = os.path.join(puzzle_dir, f"Guardian_{user_text}_{user_number}.puz")
    Crossword(user_text, user_number, filename)
    return send_file(filename, as_attachment=True)


# ---------------------------------------------------------------------------
# Serve React SPA (production build)
# ---------------------------------------------------------------------------

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react(path):
    full = os.path.join(STATIC_DIR, path)
    if path and os.path.exists(full):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, 'index.html')


# ---------------------------------------------------------------------------
# WebSocket events
# ---------------------------------------------------------------------------

@socketio.on('join_game')
def handle_join_game(data):
    game_id = data['game_id']
    player_id = data['player_id']

    if game_id not in games:
        emit('error', {'message': 'Game not found'})
        return

    # Leave previous room if switching games
    old_room = socket_rooms.get(request.sid)
    if old_room and old_room != game_id:
        leave_room(old_room)

    socket_rooms[request.sid] = game_id
    join_room(game_id)

    players = game_players[game_id]
    if player_id not in players:
        idx = len(players)
        players[player_id] = {
            'name': f'Player {idx + 1}',
            'color': PLAYER_COLORS[idx % len(PLAYER_COLORS)],
        }
        # Announce new player to everyone already in the room
        emit('player_list', {'players': players}, to=game_id)

    emit('current_state', {
        'cells': room_states.get(game_id, {}),
        'cellOwners': cell_owners.get(game_id, {}),
        'players': players,
        'myPlayerId': player_id,
    })


@socketio.on('cell_change')
def handle_cell_change(data):
    game_id = data['game_id']
    player_id = data['player_id']
    key = f"{data['row']},{data['col']}"
    char = data.get('char', '')

    state = room_states.setdefault(game_id, {})
    owners = cell_owners.setdefault(game_id, {})
    if char:
        state[key] = char
        owners[key] = player_id
    else:
        state.pop(key, None)
        owners.pop(key, None)

    color = game_players.get(game_id, {}).get(player_id, {}).get('color', '#999999')
    emit(
        'cell_change',
        {'row': data['row'], 'col': data['col'], 'char': char,
         'game_id': game_id, 'player_id': player_id, 'color': color},
        to=game_id, include_self=False,
    )


@socketio.on('clear_all')
def handle_clear_all(data):
    game_id = data['game_id']
    if game_id in room_states:
        room_states[game_id] = {}
    if game_id in cell_owners:
        cell_owners[game_id] = {}
    emit('clear_all', {'game_id': game_id}, to=game_id, include_self=False)


@socketio.on('disconnect')
def handle_disconnect():
    socket_rooms.pop(request.sid, None)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False, allow_unsafe_werkzeug=True)


