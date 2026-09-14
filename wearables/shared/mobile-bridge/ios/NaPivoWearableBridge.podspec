require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NaPivoWearableBridge'
  s.version        = package['version']
  s.summary        = 'Durable phone transport for Na pivo wearable applications'
  s.description    = 'Bridges the shared wearable protocol to WatchConnectivity without exposing account tokens.'
  s.license        = 'MIT'
  s.author         = 'Na pivo'
  s.homepage       = 'https://na-pivo.cz'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/tomasmach/na-pivo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.swift'
end
