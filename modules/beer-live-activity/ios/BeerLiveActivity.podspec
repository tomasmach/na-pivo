require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'BeerLiveActivity'
  s.version        = package['version']
  s.summary        = 'Native bridge for Na pivo live activity interactions'
  s.description    = 'Reads and acknowledges durable beer-add events created by the iOS Live Activity.'
  s.license        = 'MIT'
  s.author         = 'Na pivo'
  s.homepage       = 'https://na-pivo.cz'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/tomasmach/na-pivo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.swift'
end
