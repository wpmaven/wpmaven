<?php
/**
 * Conversation Management Class
 */

if (!defined('ABSPATH')) {
    exit;
}

class WebMaven_WP_Conversation {
    
    private $api_client;
    private $conversation_id;
    
    public function __construct($conversation_id = null) {
        $this->api_client = new WebMaven_WP_API_Client();
        $this->conversation_id = $conversation_id;
    }
    
    /**
     * Create a new conversation
     */
    public function create_conversation($title, $initial_message = null) {
        $response = $this->api_client->create_conversation($title, $initial_message);
        
        if ($response['success']) {
            $this->conversation_id = $response['data']['conversationId'];
            
            // Store conversation in local database
            $this->store_conversation_locally($response['data']);
            
            return $response['data'];
        }
        
        return false;
    }
    
    /**
     * Send a message to the conversation
     */
    public function send_message($content, $metadata = array()) {
        if (!$this->conversation_id) {
            return array('success' => false, 'error' => 'No active conversation');
        }
        
        $response = $this->api_client->send_message($this->conversation_id, $content, $metadata);
        
        if ($response['success']) {
            // Update local conversation timestamp
            $this->update_conversation_timestamp();
        }
        
        return $response;
    }
    
    /**
     * Get conversation history
     */
    public function get_conversation_history() {
        if (!$this->conversation_id) {
            return array('success' => false, 'error' => 'No active conversation');
        }
        
        return $this->api_client->get_conversation($this->conversation_id);
    }
    
    /**
     * List all conversations
     */
    public function list_conversations() {
        return $this->api_client->list_conversations();
    }
    
    /**
     * Store conversation locally
     */
    private function store_conversation_locally($conversation_data) {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'webmaven_wp_conversations';
        
        $wpdb->insert(
            $table_name,
            array(
                'conversation_id' => $conversation_data['conversationId'],
                'title' => $conversation_data['title'],
                'created_at' => current_time('mysql'),
                'updated_at' => current_time('mysql')
            ),
            array('%s', '%s', '%s', '%s')
        );
    }
    
    /**
     * Update conversation timestamp
     */
    private function update_conversation_timestamp() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'webmaven_wp_conversations';
        
        $wpdb->update(
            $table_name,
            array('updated_at' => current_time('mysql')),
            array('conversation_id' => $this->conversation_id),
            array('%s'),
            array('%s')
        );
    }
    
    /**
     * Get local conversations
     */
    public function get_local_conversations() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'webmaven_wp_conversations';
        
        return $wpdb->get_results(
            "SELECT * FROM $table_name ORDER BY updated_at DESC"
        );
    }
    
    /**
     * Delete conversation
     */
    public function delete_conversation($conversation_id = null) {
        $id = $conversation_id ?: $this->conversation_id;
        
        if (!$id) {
            return array('success' => false, 'error' => 'No conversation ID provided');
        }
        
        // Delete from local database
        global $wpdb;
        $table_name = $wpdb->prefix . 'webmaven_wp_conversations';
        
        $deleted = $wpdb->delete(
            $table_name,
            array('conversation_id' => $id),
            array('%s')
        );
        
        return array('success' => $deleted !== false);
    }
    
    /**
     * Update conversation title
     */
    public function update_conversation_title($title, $conversation_id = null) {
        $id = $conversation_id ?: $this->conversation_id;
        
        if (!$id) {
            return array('success' => false, 'error' => 'No conversation ID provided');
        }
        
        global $wpdb;
        $table_name = $wpdb->prefix . 'webmaven_wp_conversations';
        
        $updated = $wpdb->update(
            $table_name,
            array(
                'title' => $title,
                'updated_at' => current_time('mysql')
            ),
            array('conversation_id' => $id),
            array('%s', '%s'),
            array('%s')
        );
        
        return array('success' => $updated !== false);
    }
}
