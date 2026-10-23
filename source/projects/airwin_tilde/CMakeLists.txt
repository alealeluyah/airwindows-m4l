include(${C74_MAX_API_DIR}/script/max-pretarget.cmake)

include_directories("${C74_INCLUDES}")

add_library(${PROJECT_NAME} MODULE airwin_tilde.cpp)
target_link_libraries(${PROJECT_NAME} PRIVATE airwin-core)

include(${C74_MAX_API_DIR}/script/max-posttarget.cmake)
