# Publish each submodule's static web app at its public route.
module Jekyll
  class AtlasStaticFile < StaticFile
    def initialize(site, source_path, route, relative_path)
      super(site, site.source, File.dirname(source_path), File.basename(source_path))
      @public_path = File.join(route, relative_path)
    end

    def destination(dest)
      File.join(dest, @public_path)
    end

    def url
      "/#{@public_path}"
    end
  end

  class AtlasProjectsGenerator < Generator
    safe true
    priority :low

    APPS = {
      'atlas-projects/abandoned-airfields/web' => 'abandoned-airfield-atlas',
      'atlas-projects/air-crashes/web' => 'air-crash-atlas'
    }.freeze
    OMIT = %w[data/events.json data/events.previous.geojson].freeze

    def generate(site)
      APPS.each do |source, route|
        web_root = File.join(site.source, source)
        unless File.file?(File.join(web_root, 'index.html'))
          raise "Missing AtlasProjects submodule: #{source}. Run git submodule update --init --recursive."
        end

        Dir.glob(File.join(web_root, '**', '*')).sort.each do |path|
          next unless File.file?(path)
          relative = path.delete_prefix("#{web_root}/")
          next if OMIT.include?(relative)

          site.static_files << AtlasStaticFile.new(site, File.join(source, relative), route, relative)
        end
      end
    end
  end
end
