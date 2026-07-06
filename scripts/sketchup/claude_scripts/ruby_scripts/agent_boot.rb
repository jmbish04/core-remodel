# frozen_string_literal: true
#
# agent_boot.rb — robust supex boot for agentic sessions.
#
# Loaded via SketchUp's `-RubyStartup`. It loads the supex extension and then starts
# the bridge from a REPEATING timer that keeps retrying until the bridge actually binds.
#
# Why: supex auto-starts its bridge from a ONE-SHOT `UI.start_timer(1.0, false)`. On
# SketchUp 2026 that single fire is lost whenever the run loop is blocked at startup —
# by the modal "Welcome" window OR by a long synchronous load of a big model (base_colby
# is ~66 MB). When it's lost, the bridge never binds and the MCP tools stay disconnected.
# A repeating timer fires again once the loop goes idle, so it survives both cases.

BOOT_LOG = '/Volumes/Projects/workers/core-remodel/scripts/sketchup/supex/.tmp/agent_boot.log'

def agent_boot_log(msg)
  File.open(BOOT_LOG, 'a') { |f| f.puts("#{Time.now.strftime('%H:%M:%S')} agent_boot: #{msg}") }
rescue StandardError
  nil
end

agent_boot_log("start (SketchUp #{begin; Sketchup.version; rescue StandardError; '?'; end})")

# Disable supex's own one-shot auto-start so we are the single, robust starter.
ENV['SUPEX_NO_AUTOSTART'] = '1'

# Load the supex extension exactly the way its own injector does.
SUPEX_INJECTOR = '/Volumes/Projects/workers/core-remodel/scripts/sketchup/supex/runtime/src/injector.rb'
begin
  load SUPEX_INJECTOR
  agent_boot_log('supex injector loaded')
rescue StandardError => e
  agent_boot_log("injector load FAILED: #{e.message}")
end

# Repeating starter: tick every 2s until the bridge is up (or we give up).
$agent_boot_attempts = 0
$agent_boot_timer = UI.start_timer(2.0, true) do
  begin
    $agent_boot_attempts += 1
    if defined?(SupexRuntime::Main)
      bridge = SupexRuntime::Main.instance_variable_get(:@bridge_server)
      if bridge.nil?
        agent_boot_log("attempt #{$agent_boot_attempts}: calling Main.start")
        SupexRuntime::Main.start
      else
        agent_boot_log("bridge up after #{$agent_boot_attempts} attempt(s); stopping starter")
        UI.stop_timer($agent_boot_timer)
      end
    else
      agent_boot_log("attempt #{$agent_boot_attempts}: SupexRuntime::Main not defined yet")
    end
    if $agent_boot_attempts > 90 # ~3 min safety cap
      agent_boot_log('giving up after 90 attempts')
      UI.stop_timer($agent_boot_timer)
    end
  rescue StandardError => e
    agent_boot_log("tick error: #{e.message}")
  end
end
agent_boot_log('repeating starter timer scheduled')
