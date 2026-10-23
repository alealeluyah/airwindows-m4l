add_executable(awtool awtool.cpp)
target_link_libraries(awtool PRIVATE airwin-core)
target_compile_definitions(awtool PRIVATE _USE_MATH_DEFINES)
