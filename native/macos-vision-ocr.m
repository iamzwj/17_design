#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "缺少图片路径\n");
            return 2;
        }

        NSString *imagePath = [NSString stringWithUTF8String:argv[1]];
        NSURL *imageURL = [NSURL fileURLWithPath:imagePath];
        NSImage *image = [[NSImage alloc] initWithContentsOfURL:imageURL];
        if (!image) {
            fprintf(stderr, "无法读取图片\n");
            return 3;
        }

        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.revision = VNRecognizeTextRequestRevision3;
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.recognitionLanguages = @[@"zh-Hans", @"en-US"];
        request.usesLanguageCorrection = YES;

        NSError *error = nil;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:imageURL options:@{}];
        if (![handler performRequests:@[request] error:&error]) {
            fprintf(stderr, "文字识别失败：%s\n", error.localizedDescription.UTF8String);
            return 5;
        }

        NSArray<VNRecognizedTextObservation *> *observations = [request.results sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *left, VNRecognizedTextObservation *right) {
            CGFloat verticalDelta = CGRectGetMidY(left.boundingBox) - CGRectGetMidY(right.boundingBox);
            if (fabs(verticalDelta) > 0.02) return verticalDelta > 0 ? NSOrderedAscending : NSOrderedDescending;
            if (CGRectGetMinX(left.boundingBox) < CGRectGetMinX(right.boundingBox)) return NSOrderedAscending;
            return NSOrderedDescending;
        }];

        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        for (VNRecognizedTextObservation *observation in observations) {
            VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
            NSString *line = [candidate.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            if (line.length > 0) [lines addObject:line];
        }
        printf("%s\n", [[lines componentsJoinedByString:@"\n"] UTF8String]);
    }
    return 0;
}
