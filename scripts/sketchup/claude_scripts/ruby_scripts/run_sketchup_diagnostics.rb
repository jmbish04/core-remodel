# Extract comprehensive structural data and export to JSON
require 'sketchup'
require 'json'

module ComprehensiveModelExtractor
  @loose_geometry_count = 0
  @extracted_data = {}

  # Helper to round floats to 2 decimal places
  def self.f(val)
    val.to_f.round(2)
  end

  def self.process_entities(ents, path = "")
    ents.each do |ent|
      if ent.is_a?(Sketchup::Face) || ent.is_a?(Sketchup::Edge)
        # Count loose geometry at the root level to warn the user
        @loose_geometry_count += 1 if path.empty?
      elsif ent.is_a?(Sketchup::Group) || ent.is_a?(Sketchup::ComponentInstance)
        type = ent.is_a?(Sketchup::Group) ? "Group" : "Component"
        instance_name = ent.name
        definition_name = ent.is_a?(Sketchup::ComponentInstance) ? ent.definition.name : (ent.name.empty? ? "Unnamed Group" : ent.name)
        
        # Handle nested pathing (e.g., "Upper Level Structure > Wall")
        node_name = instance_name.empty? ? definition_name : instance_name
        full_path = path.empty? ? node_name : "#{path} > #{node_name}"
        
        tag = ent.layer.name
        visible = !ent.hidden?
        
        # Bounding Box calculations in global coordinates
        bbox = ent.bounds
        
        obj_data = {
          type: type,
          path: full_path,
          tag: tag,
          visible: visible,
          dimensions: {
            width_x: f(bbox.width),
            depth_y: f(bbox.height),
            height_z: f(bbox.depth)
          },
          z_bounds: { min: f(bbox.min.z), max: f(bbox.max.z) },
          x_bounds: { min: f(bbox.min.x), max: f(bbox.max.x) },
          y_bounds: { min: f(bbox.min.y), max: f(bbox.max.y) }
        }
        
        @extracted_data[:objects] << obj_data
        
        # Recursively drill down into nested groups/components
        if ent.is_a?(Sketchup::Group)
          process_entities(ent.entities, full_path)
        elsif ent.is_a?(Sketchup::ComponentInstance)
          process_entities(ent.definition.entities, full_path)
        end
      end
    end
  end

  def self.extract
    model = Sketchup.active_model
    return puts("No active model found.") unless model

    # Prompt user for save location
    filepath = UI.savepanel("Save JSON Diagnostics", "~", "sketchup_diagnostics.json")
    return puts("Extraction cancelled by user.") unless filepath

    puts "--- BEGIN JSON EXPORT ---"
    
    @loose_geometry_count = 0
    @extracted_data = {
      model_name: model.title.empty? ? "Untitled" : model.title,
      export_time: Time.now.to_s,
      objects: [],
      warnings: []
    }

    # Force the script to look at the ROOT of the document
    process_entities(model.entities)
    
    if @loose_geometry_count > 0
      warning_msg = "Found #{@loose_geometry_count} loose edges/faces at the root level. These were not exported."
      @extracted_data[:warnings] << warning_msg
      puts "⚠️ WARNING: #{warning_msg}"
    end

    begin
      File.open(filepath, "w") do |file|
        file.write(JSON.pretty_generate(@extracted_data))
      end
      puts "✅ Successfully exported #{@extracted_data[:objects].length} objects to:"
      puts "   #{filepath}"
    rescue => e
      puts "❌ Error saving file: #{e.message}"
    end

    puts "--- END JSON EXPORT ---"
  end
end

ComprehensiveModelExtractor.extract