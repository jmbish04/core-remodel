-- Seed data for the database

-- Insert demo users (password: "password123" hashed with SHA-256)
INSERT INTO users (email, password_hash, name) VALUES
('admin@example.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'Admin User'),
('demo@example.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'Demo User');

-- Insert dashboard metrics
INSERT INTO dashboard_metrics (metric_name, metric_value, metric_type, category) VALUES
('Total Users', 1250, 'count', 'users'),
('Active Users', 823, 'count', 'users'),
('User Growth Rate', 15.3, 'percentage', 'users'),
('Monthly Revenue', 45678.90, 'currency', 'revenue'),
('Revenue Growth', 8.5, 'percentage', 'revenue'),
('API Response Time', 145, 'time', 'performance'),
('Cache Hit Rate', 87.5, 'percentage', 'performance'),
('Database Load', 34.2, 'percentage', 'system'),
('CPU Usage', 23.8, 'percentage', 'system'),
('Memory Usage', 56.3, 'percentage', 'system'),
('Total Requests', 125430, 'count', 'performance'),
('Error Rate', 0.23, 'percentage', 'performance'),
('Success Rate', 99.77, 'percentage', 'performance'),
('Average Session Time', 342, 'time', 'users'),
('Conversion Rate', 4.2, 'percentage', 'revenue');

-- Insert sample health checks
INSERT INTO health_checks (service_name, status, response_time) VALUES
('api', 'healthy', 45),
('database', 'healthy', 12),
('workers-ai', 'healthy', 234),
('ai-gateway', 'healthy', 89),
('cdn', 'healthy', 23);

-- Insert sample notifications
INSERT INTO notifications (user_id, type, title, message, is_read) VALUES
(1, 'info', 'Welcome!', 'Welcome to the platform. Your account has been created successfully.', false),
(1, 'success', 'System Update', 'The system has been successfully updated to version 2.0.', false),
(1, 'warning', 'High Traffic', 'Your API is experiencing higher than normal traffic.', true),
(2, 'info', 'New Feature', 'Check out our new AI assistant features!', false),
(2, 'success', 'Task Completed', 'Your background task has completed successfully.', true);

-- Insert sample threads
INSERT INTO threads (user_id, title) VALUES
(1, 'Getting Started with AI'),
(1, 'Project Planning Discussion'),
(2, 'Technical Support Request');

-- Insert sample messages
INSERT INTO messages (thread_id, role, content) VALUES
(1, 'user', 'Hello! Can you help me understand how to use the AI features?'),
(1, 'assistant', 'Of course! I''d be happy to help you get started with our AI features. We have several capabilities including chat, speech-to-text, and text-to-speech. What would you like to explore first?'),
(1, 'user', 'I''m interested in the speech-to-text feature.'),
(2, 'user', 'I need to plan a new project. Can you help me outline the key steps?'),
(2, 'assistant', 'Absolutely! Let''s break down your project planning into key phases: 1) Define objectives, 2) Identify stakeholders, 3) Set timeline, 4) Allocate resources, 5) Risk assessment. Which phase would you like to focus on first?'),
(3, 'user', 'I''m having trouble connecting to the API.'),
(3, 'assistant', 'I can help you troubleshoot that. Can you provide more details about the error you''re seeing?');

-- Insert sample documents
INSERT INTO documents (user_id, title, content) VALUES
(1, 'Project Overview', '[{"type":"paragraph","children":[{"text":"This is a sample project overview document."}]}]'),
(1, 'Meeting Notes', '[{"type":"paragraph","children":[{"text":"Meeting notes from today..."}]}]'),
(2, 'Technical Specification', '[{"type":"paragraph","children":[{"text":"Technical specifications for the new feature."}]}]');
