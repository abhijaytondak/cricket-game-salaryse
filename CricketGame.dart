import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'dart:convert';

class CricketGame extends StatefulWidget {
  final String gameUrl;
  final Function(int score)? onGameOver;
  final Function()? onGameStart;
  final Function(String error)? onError;

  const CricketGame({
    super.key,
    required this.gameUrl,
    this.onGameOver,
    this.onGameStart,
    this.onError,
  });

  @override
  State<CricketGame> createState() => CricketGameState();
}

class CricketGameState extends State<CricketGame> {
  late final WebViewController _controller;
  bool _isPageLoaded = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..setNavigationDelegate(
        NavigationDelegate(
          // #38: Handle load errors
          onWebResourceError: (WebResourceError error) {
            setState(() => _hasError = true);
            debugPrint('WebView error: ${error.description}');
            if (widget.onError != null) {
              widget.onError!(error.description);
            }
          },
          onPageFinished: (String url) {
            setState(() {
              _isPageLoaded = true;
              _hasError = false;
            });
          },
        ),
      )
      ..addJavaScriptChannel(
        'CricketGameChannel',
        onMessageReceived: (JavaScriptMessage message) {
          try {
            final data = jsonDecode(message.message);
            if (data['type'] == 'GAME_OVER') {
              // #39: Safely parse score as int from any numeric type
              final score = (data['score'] as num).toInt();
              if (widget.onGameOver != null) {
                widget.onGameOver!(score);
              }
            } else if (data['type'] == 'GAME_START') {
              if (widget.onGameStart != null) {
                widget.onGameStart!();
              }
            }
          } catch (e) {
            debugPrint('Error parsing game message: $e');
          }
        },
      )
      ..loadRequest(Uri.tryParse(widget.gameUrl) ?? Uri.parse('about:blank'));
  }

  // #37: Only call restart if page is loaded
  void restartGame() {
    if (_isPageLoaded && !_hasError) {
      _controller.runJavaScript('if(window.restartCricketGame) window.restartCricketGame()');
    } else {
      debugPrint('Cannot restart: page not loaded or has error');
      // Attempt to reload the page
      _controller.loadRequest(Uri.parse(widget.gameUrl));
    }
  }

  // #36: Dispose the controller
  @override
  void dispose() {
    // WebViewController doesn't have a dispose method itself,
    // but clearing the page prevents further resource usage
    _controller.loadRequest(Uri.parse('about:blank'));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            WebViewWidget(controller: _controller),
            // #38: Error overlay with retry
            if (_hasError)
              Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, color: Colors.white54, size: 48),
                    const SizedBox(height: 16),
                    const Text(
                      'Failed to load game',
                      style: TextStyle(color: Colors.white70, fontSize: 16),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () {
                        setState(() => _hasError = false);
                        _controller.loadRequest(Uri.parse(widget.gameUrl));
                      },
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/*
Usage:
CricketGame(
  gameUrl: 'https://ais-dev-cqq4oozm2rxki4rq3r4wcs-626467535684.asia-east1.run.app',
  onGameStart: () {
    print('Innings Started!');
  },
  onGameOver: (score) {
    print('Game Over! Final Score: \$score');
  },
  onError: (error) {
    print('Game error: \$error');
  },
)
*/
