import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import '../services/api_service.dart';
import 'login_screen.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  bool _isScanning = true;
  bool _isProcessing = false;
  String? _scannedData;
  String? _errorMessage;
  String? _successMessage;
  String? _diagnosticInfo;
  Position? _currentPosition;
  bool _cameraPermissionGranted = false;
  bool _locationPermissionGranted = false;
  bool _locationServiceEnabled = false;
  MobileScannerController? _controller;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController();
    _requestPermissions();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _requestPermissions() async {
    // Request camera permission
    final cameraStatus = await Permission.camera.request();
    _cameraPermissionGranted = cameraStatus.isGranted;
    if (!cameraStatus.isGranted) {
      setState(() {
        _errorMessage = 'Camera permission is required for QR scanning';
        _updateDiagnosticInfo();
      });
    }

    // Request location permission
    final locationStatus = await Permission.location.request();
    _locationPermissionGranted = locationStatus.isGranted;
    if (!locationStatus.isGranted) {
      setState(() {
        _errorMessage = 'Location permission is required for attendance';
        _updateDiagnosticInfo();
      });
    }

    // Get current location
    _getCurrentLocation();
  }

  void _updateDiagnosticInfo() {
    setState(() {
      _diagnosticInfo = 'Camera: ${_cameraPermissionGranted ? "Granted" : "Denied"}, '
          'Location: ${_locationPermissionGranted ? "Granted" : "Denied"}, '
          'Service: ${_locationServiceEnabled ? "On" : "Off"}';
    });
    print('DIAGNOSTIC: $_diagnosticInfo');
  }

  Future<void> _getCurrentLocation() async {
    try {
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      _locationServiceEnabled = serviceEnabled;
      if (!serviceEnabled) {
        setState(() {
          _errorMessage = 'Location services are disabled';
          _updateDiagnosticInfo();
        });
        return;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          setState(() {
            _errorMessage = 'Location permissions are denied';
            _updateDiagnosticInfo();
          });
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        setState(() {
          _errorMessage = 'Location permissions are permanently denied';
          _updateDiagnosticInfo();
        });
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      setState(() {
        _currentPosition = position;
        _updateDiagnosticInfo();
      });
    } catch (e) {
      print('Error getting location: $e');
      setState(() {
        _diagnosticInfo = 'Location Error: $e';
      });
    }
  }

  Future<void> _onBarcodeDetected(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final barcode = capture.barcodes.first;
    if (barcode.rawValue == null) return;

    setState(() {
      _isProcessing = true;
      _scannedData = barcode.rawValue;
      _errorMessage = null;
      _successMessage = null;
    });

    // Stop scanning temporarily
    setState(() {
      _isScanning = false;
    });

    // Submit attendance
    final result = await ApiService.teacherCheckIn(
      qrCodeData: barcode.rawValue!,
      locationLat: _currentPosition?.latitude,
      locationLng: _currentPosition?.longitude,
    );

    setState(() {
      _isProcessing = false;
    });

    if (result['success']) {
      setState(() {
        _successMessage = 'Check-in successful!';
      });

      // Show success dialog
      if (mounted) {
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Success'),
            content: Text(result['data']['message'] ?? 'Check-in successful'),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  setState(() {
                    _isScanning = true;
                    _scannedData = null;
                    _successMessage = null;
                  });
                },
                child: const Text('OK'),
              ),
            ],
          ),
        );
      }
    } else {
      setState(() {
        _errorMessage = result['error'];
      });

      // Show error dialog
      if (mounted) {
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Error'),
            content: Text(result['error']),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  setState(() {
                    _isScanning = true;
                    _scannedData = null;
                    _errorMessage = null;
                  });
                },
                child: const Text('OK'),
              ),
            ],
          ),
        );
      }
    }
  }

  Future<void> _logout() async {
    await ApiService.clearToken();
    if (mounted) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (context) => const LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('The Eye - Teacher'),
        backgroundColor: Colors.blue,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      body: Column(
        children: [
          // Updates message
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            color: Colors.blue.shade50,
            child: Column(
              children: [
                const Icon(
                  Icons.info_outline,
                  size: 48,
                  color: Colors.blue,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Updates on the way!',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: Colors.blue,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Scan the QR code to mark your attendance',
                  style: TextStyle(
                    fontSize: 16,
                    color: Colors.grey.shade700,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),

          // Scanner container
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Error message
                  if (_errorMessage != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.red.shade200),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.error, color: Colors.red),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: const TextStyle(color: Colors.red),
                                ),
                              ),
                            ],
                          ),
                          if (_diagnosticInfo != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                _diagnosticInfo!,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),

                  // Success message
                  if (_successMessage != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: Colors.green.shade50,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.green.shade200),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle, color: Colors.green),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _successMessage!,
                              style: const TextStyle(color: Colors.green),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // QR Scanner
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Colors.grey.shade300),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: _isScanning
                            ? SizedBox(
                                width: double.infinity,
                                height: double.infinity,
                                child: MobileScanner(
                                  controller: _controller,
                                  onDetect: _onBarcodeDetected,
                                  errorBuilder: (context, error, child) {
                                    print('SCANNER ERROR: $error');
                                    print('Error code: ${error.errorCode}');
                                    print('Error details: ${error.errorDetails}');
                                    setState(() {
                                      _errorMessage = 'Scanner Error: ${error.errorCode} - ${error.errorDetails?.message ?? error.toString()}';
                                      _updateDiagnosticInfo();
                                    });
                                    return Center(
                                      child: Column(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          const Icon(Icons.error, size: 64, color: Colors.red),
                                          const SizedBox(height: 16),
                                          Text(
                                            _errorMessage ?? 'Scanner Error',
                                            style: const TextStyle(color: Colors.white),
                                            textAlign: TextAlign.center,
                                          ),
                                          if (_diagnosticInfo != null)
                                            Padding(
                                              padding: const EdgeInsets.only(top: 8),
                                              child: Text(
                                                _diagnosticInfo!,
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 12,
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                    );
                                  },
                                ),
                              )
                            : Center(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(
                                      Icons.qr_code_scanner,
                                      size: 64,
                                      color: Colors.grey,
                                    ),
                                    const SizedBox(height: 16),
                                    Text(
                                      _scannedData ?? 'Scanning paused',
                                      style: TextStyle(
                                        color: Colors.grey.shade600,
                                        fontSize: 16,
                                      ),
                                    ),
                                    const SizedBox(height: 16),
                                    ElevatedButton(
                                      onPressed: () {
                                        setState(() {
                                          _isScanning = true;
                                          _scannedData = null;
                                          _errorMessage = null;
                                          _successMessage = null;
                                        });
                                      },
                                      child: const Text('Scan Again'),
                                    ),
                                  ],
                                ),
                              ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Instructions
                  Text(
                    'Point your camera at the school\'s QR code',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
