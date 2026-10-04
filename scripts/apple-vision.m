#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    for (int i = 1; i < argc; i++) {
      NSString *path = [NSString stringWithUTF8String:argv[i]];
      VNDetectBarcodesRequest *request = [[VNDetectBarcodesRequest alloc] init];
      request.symbologies = @[VNBarcodeSymbologyQR];
      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc]
          initWithURL:[NSURL fileURLWithPath:path] options:@{}];
      NSError *error = nil;
      BOOL ok = [handler performRequests:@[request] error:&error];
      NSMutableArray *codes = [NSMutableArray array];
      if (ok) for (VNBarcodeObservation *observation in request.results) {
        [codes addObject:@{@"payload": observation.payloadStringValue ?: @"",
                          @"confidence": @(observation.confidence)}];
      }
      NSDictionary *row = @{@"codes": codes, @"error": error.localizedDescription ?: @""};
      NSData *data = [NSJSONSerialization dataWithJSONObject:row options:0 error:nil];
      puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    }
  }
  return 0;
}
