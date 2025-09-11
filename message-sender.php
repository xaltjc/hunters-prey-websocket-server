<?php
// Create: websocket-alternative/message-sender.php on SiteGround

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $gameId = $input['gameId'] ?? 'default';
    $message = $input['message'] ?? [];
    
    $messagesFile = "messages_{$gameId}.json";
    
    // Load existing messages
    $messages = [];
    if (file_exists($messagesFile)) {
        $messages = json_decode(file_get_contents($messagesFile), true) ?: [];
    }
    
    // Add new message
    $message['timestamp'] = time();
    $messages[] = $message;
    
    // Keep only last 100 messages
    if (count($messages) > 100) {
        $messages = array_slice($messages, -100);
    }
    
    // Save messages
    file_put_contents($messagesFile, json_encode($messages));
    
    echo json_encode(['status' => 'success']);
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
?>