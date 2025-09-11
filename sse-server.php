<?php
// Create: websocket-alternative/sse-server.php on SiteGround

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Cache-Control');

// Simple file-based message queue
$gameId = $_GET['game'] ?? 'default';
$playerId = $_GET['player'] ?? 'anonymous';
$lastEventId = $_GET['lastEventId'] ?? 0;

$messagesFile = "messages_{$gameId}.json";

while (true) {
    if (file_exists($messagesFile)) {
        $messages = json_decode(file_get_contents($messagesFile), true) ?: [];
        
        foreach ($messages as $index => $message) {
            if ($index > $lastEventId && $message['to'] !== $playerId) {
                echo "id: {$index}\n";
                echo "data: " . json_encode($message) . "\n\n";
                ob_flush();
                flush();
                $lastEventId = $index;
            }
        }
    }
    
    sleep(2); // Check every 2 seconds
    
    // Prevent timeout
    if (connection_aborted()) break;
}
?>